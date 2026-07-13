import Stripe from "npm:stripe@22.0.0";

import {
    createClient
} from "npm:@supabase/supabase-js@2.110.2";


const cryptoProvider =
    Stripe.createSubtleCryptoProvider();


function jsonResponse(
    body: Record<string, unknown>,
    status = 200
) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}


function getPaymentIntentId(
    paymentIntent:
        | string
        | Stripe.PaymentIntent
        | null
) {
    if (typeof paymentIntent === "string") {
        return paymentIntent;
    }

    return paymentIntent?.id || null;
}


function getReleasePaymentStatus(
    eventType: string
) {
    if (
        eventType ===
        "checkout.session.expired"
    ) {
        return "cancelled";
    }

    if (
        eventType ===
        "checkout.session.async_payment_failed"
    ) {
        return "failed";
    }

    return null;
}


Deno.serve(async (request) => {
    if (request.method !== "POST") {
        return jsonResponse(
            { error: "Method not allowed." },
            405
        );
    }

    const signature =
        request.headers.get("stripe-signature");

    if (!signature) {
        return jsonResponse(
            { error: "Missing Stripe signature." },
            400
        );
    }

    const webhookSecret =
        Deno.env.get("STRIPE_WEBHOOK_SECRET");

    const stripeSecretKey =
        Deno.env.get("STRIPE_SECRET_KEY");

    const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
        !webhookSecret ||
        !stripeSecretKey ||
        !supabaseUrl ||
        !serviceRoleKey
    ) {
        console.error(
            "Stripe webhook is missing required server configuration."
        );

        return jsonResponse(
            { error: "Webhook is not configured." },
            500
        );
    }

    const rawBody = await request.text();

    const stripe = new Stripe(stripeSecretKey);

    let event: Stripe.Event;

    try {
        event =
            await stripe.webhooks
                .constructEventAsync(
                    rawBody,
                    signature,
                    webhookSecret,
                    undefined,
                    cryptoProvider
                );
    } catch (error) {
        console.error(
            "Stripe webhook signature verification failed:",
            error instanceof Error
                ? error.message
                : "Unknown signature error"
        );

        return jsonResponse(
            { error: "Invalid Stripe signature." },
            400
        );
    }

    const isSuccessfulPaymentEvent =
        event.type ===
            "checkout.session.completed" ||
        event.type ===
            "checkout.session.async_payment_succeeded";

    const releasePaymentStatus =
        getReleasePaymentStatus(event.type);

    if (
        !isSuccessfulPaymentEvent &&
        !releasePaymentStatus
    ) {
        return jsonResponse({ received: true });
    }

    const session =
        event.data.object as
            Stripe.Checkout.Session;

    const bookingId =
        String(
            session.metadata?.booking_id || ""
        ).trim();

    const courseId =
        String(
            session.metadata?.course_id || ""
        ).trim();

    if (
        !/^[1-9]\d{0,18}$/.test(bookingId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(courseId)
    ) {
        console.error(
            "Stripe session has incomplete booking metadata."
        );

        return jsonResponse(
            { error: "Payment details were incomplete." },
            400
        );
    }

    const supabaseAdmin = createClient(
        supabaseUrl,
        serviceRoleKey,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    );

    if (releasePaymentStatus) {
        const {
            data: releaseResults,
            error: releaseError
        } = await supabaseAdmin.rpc(
            "release_stripe_checkout_hold",
            {
                p_booking_id: bookingId,
                p_course_id: courseId,
                p_stripe_checkout_session_id:
                    session.id,
                p_payment_status:
                    releasePaymentStatus
            }
        );

        if (releaseError) {
            console.error(
                "Stripe checkout hold release failed:",
                releaseError.message
            );

            return jsonResponse(
                { error: "Checkout hold could not be released." },
                500
            );
        }

        const releaseResult =
            Array.isArray(releaseResults)
                ? releaseResults[0]
                : null;

        return jsonResponse({
            received: true,
            booking_id:
                releaseResult?.booking_id == null
                    ? null
                    : String(
                        releaseResult.booking_id
                    ),
            released:
                releaseResult?.released === true
        });
    }

    if (session.payment_status !== "paid") {
        return jsonResponse({
            received: true,
            payment_pending: true
        });
    }

    const paymentIntentId =
        getPaymentIntentId(
            session.payment_intent
        );

    const amountTotal =
        Number(session.amount_total);

    const currency =
        String(session.currency || "")
            .toLowerCase();

    if (
        !paymentIntentId ||
        !Number.isSafeInteger(amountTotal) ||
        amountTotal <= 0 ||
        !/^[a-z]{3}$/.test(currency)
    ) {
        console.error(
            "Paid Stripe session has incomplete booking metadata."
        );

        return jsonResponse(
            { error: "Payment details were incomplete." },
            400
        );
    }

    const {
        data: booking,
        error: bookingError
    } = await supabaseAdmin
        .from("bookings")
        .select(
            "id, course_id, payment_status, reservation_status, stripe_checkout_session_id, stripe_payment_intent_id, checkout_total, checkout_currency"
        )
        .eq("id", bookingId)
        .eq(
            "stripe_checkout_session_id",
            session.id
        )
        .maybeSingle();

    if (bookingError) {
        console.error(
            "Webhook booking lookup failed:",
            bookingError.message
        );

        return jsonResponse(
            { error: "Payment could not be recorded." },
            500
        );
    }

    if (!booking) {
        console.error(
            "Webhook did not match a CoursePilot booking."
        );

        return jsonResponse({ received: true });
    }

    if (
        String(booking.course_id) !== courseId
    ) {
        console.error(
            "Webhook course metadata did not match the booking."
        );

        return jsonResponse(
            { error: "Payment details did not match." },
            400
        );
    }

    if (booking.payment_status === "paid") {
        if (
            booking.stripe_payment_intent_id ===
                paymentIntentId
        ) {
            return jsonResponse({
                received: true,
                already_recorded: true
            });
        }

        console.error(
            "Paid booking received a different PaymentIntent."
        );

        return jsonResponse(
            { error: "Payment details did not match." },
            409
        );
    }

    const trustedTotal =
        Number(booking.checkout_total);

    const trustedAmount =
        Math.round(trustedTotal * 100);

    const trustedCurrency =
        String(booking.checkout_currency || "")
            .toLowerCase();

    if (
        !Number.isFinite(trustedTotal) ||
        !Number.isSafeInteger(trustedAmount) ||
        trustedAmount !== amountTotal ||
        trustedCurrency !== currency
    ) {
        console.error(
            "Paid Stripe amount did not match trusted booking pricing."
        );

        return jsonResponse(
            { error: "Payment amount did not match." },
            409
        );
    }

    const paidAt = new Date().toISOString();

    const {
        data: updatedBooking,
        error: updateError
    } = await supabaseAdmin
        .from("bookings")
        .update({
            payment_status: "paid",
            reservation_status: "reserved",
            reservation_expires_at: null,
            stripe_payment_intent_id:
                paymentIntentId,
            paid_amount: trustedTotal,
            paid_currency: trustedCurrency,
            paid_at: paidAt
        })
        .eq("id", booking.id)
        .eq("payment_status", "pending")
        .eq("reservation_status", "held")
        .eq(
            "stripe_checkout_session_id",
            session.id
        )
        .select("id")
        .maybeSingle();

    if (updateError || !updatedBooking) {
        console.error(
            "Webhook booking update failed:",
            updateError?.message ||
                "Booking state changed"
        );

        return jsonResponse(
            { error: "Payment could not be recorded." },
            500
        );
    }

    return jsonResponse({
        received: true,
        booking_id: String(updatedBooking.id)
    });
});
