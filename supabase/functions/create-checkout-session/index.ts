import Stripe from "npm:stripe@22.0.0";

import {
    createClient
} from "npm:@supabase/supabase-js@2.110.2";

import {
    corsHeaders
} from "npm:@supabase/supabase-js@2.110.2/cors";


const CHECKOUT_DURATION_SECONDS =
    (30 * 60) + 5;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RETURN_URLS =
    new Map<string, string>([
        [
            "https://crsoukup81.github.io",
            "https://crsoukup81.github.io/coursepilot/"
        ],
        [
            "https://coursepilotgolf.netlify.app",
            "https://coursepilotgolf.netlify.app/"
        ],
        [
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5173/"
        ],
        [
            "http://localhost:5173",
            "http://localhost:5173/"
        ]
    ]);


type CheckoutRequest = {
    booking_id?: number | string;
    checkout_access_token?: string;
};


function getResponseHeaders(origin: string) {
    return {
        ...corsHeaders,
        "Access-Control-Allow-Origin": origin,
        "Content-Type": "application/json",
        "Vary": "Origin"
    };
}


function jsonResponse(
    origin: string,
    body: Record<string, unknown>,
    status = 200
) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: getResponseHeaders(origin)
        }
    );
}


function getBookingId(value: unknown) {
    const bookingId =
        String(value ?? "").trim();

    if (!/^[1-9]\d{0,18}$/.test(bookingId)) {
        return null;
    }

    return BigInt(bookingId) <=
        9223372036854775807n
        ? bookingId
        : null;
}


Deno.serve(async (request) => {
    const origin =
        request.headers.get("origin") || "";

    const returnUrl = RETURN_URLS.get(origin);

    if (!returnUrl) {
        return new Response(
            JSON.stringify({
                error: "This checkout origin is not allowed."
            }),
            {
                status: 403,
                headers: {
                    "Content-Type": "application/json",
                    "Vary": "Origin"
                }
            }
        );
    }

    if (request.method === "OPTIONS") {
        return new Response(
            JSON.stringify({ ok: true }),
            {
                headers: getResponseHeaders(origin)
            }
        );
    }

    if (request.method !== "POST") {
        return jsonResponse(
            origin,
            { error: "Method not allowed." },
            405
        );
    }

    const stripeSecretKey =
        Deno.env.get("STRIPE_SECRET_KEY");

    const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
        !supabaseUrl ||
        !serviceRoleKey
    ) {
        console.error(
            "Checkout function is missing required server configuration."
        );

        return jsonResponse(
            origin,
            { error: "Online checkout could not be started." },
            500
        );
    }

    let checkoutRequest: CheckoutRequest;

    try {
        checkoutRequest =
            await request.json();
    } catch {
        return jsonResponse(
            origin,
            { error: "The checkout request was invalid." },
            400
        );
    }

    const bookingId =
        getBookingId(checkoutRequest.booking_id);

    const checkoutAccessToken =
        String(
            checkoutRequest.checkout_access_token || ""
        ).trim();

    if (
        !bookingId ||
        !UUID_PATTERN.test(checkoutAccessToken)
    ) {
        return jsonResponse(
            origin,
            { error: "The checkout request was invalid." },
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

    const {
        data: booking,
        error: bookingError
    } = await supabaseAdmin
        .from("bookings")
        .select(
            "id, course_id, name, day, time, players, holes, payment_method, payment_status, reservation_status, reservation_expires_at, checkout_access_token, checkout_total, checkout_currency, stripe_checkout_session_id"
        )
        .eq("id", bookingId)
        .eq(
            "checkout_access_token",
            checkoutAccessToken
        )
        .maybeSingle();

    if (bookingError) {
        console.error(
            "Checkout booking lookup failed:",
            bookingError.message
        );

        return jsonResponse(
            origin,
            { error: "Online checkout could not be started." },
            500
        );
    }

    if (!booking) {
        return jsonResponse(
            origin,
            { error: "This checkout reservation was not found." },
            404
        );
    }

    const reservationExpiresAt =
        Date.parse(booking.reservation_expires_at || "");

    if (
        booking.payment_method !== "online" ||
        booking.payment_status !== "pending" ||
        booking.reservation_status !== "held" ||
        !Number.isFinite(reservationExpiresAt) ||
        reservationExpiresAt <= Date.now()
    ) {
        return jsonResponse(
            origin,
            {
                error:
                    "This checkout reservation is no longer available."
            },
            409
        );
    }

    const checkoutTotal =
        Number(booking.checkout_total);

    const checkoutAmount =
        Math.round(checkoutTotal * 100);

    const checkoutCurrency =
        String(booking.checkout_currency || "")
            .toLowerCase();

    if (
        !Number.isFinite(checkoutTotal) ||
        !Number.isSafeInteger(checkoutAmount) ||
        checkoutAmount <= 0 ||
        !/^[a-z]{3}$/.test(checkoutCurrency)
    ) {
        console.error(
            "Checkout booking has invalid trusted pricing."
        );

        return jsonResponse(
            origin,
            { error: "Online checkout could not be started." },
            500
        );
    }

    if (!stripeSecretKey) {
        console.error(
            "Checkout function is missing the Stripe secret key."
        );

        return jsonResponse(
            origin,
            { error: "Online checkout is not configured yet." },
            503
        );
    }

    const stripe = new Stripe(stripeSecretKey);

    if (booking.stripe_checkout_session_id) {
        try {
            const existingSession =
                await stripe.checkout.sessions.retrieve(
                    booking.stripe_checkout_session_id
                );

            if (
                existingSession.status === "open" &&
                existingSession.url
            ) {
                return jsonResponse(
                    origin,
                    { checkout_url: existingSession.url }
                );
            }
        } catch (error) {
            console.error(
                "Existing Stripe Checkout lookup failed:",
                error instanceof Error
                    ? error.message
                    : "Unknown Stripe error"
            );
        }

        return jsonResponse(
            origin,
            {
                error:
                    "This checkout session is no longer available."
            },
            409
        );
    }

    const stripeExpiration =
        Math.floor(Date.now() / 1000) +
        CHECKOUT_DURATION_SECONDS;

    let checkoutSession: Stripe.Checkout.Session;

    try {
        checkoutSession =
            await stripe.checkout.sessions.create(
                {
                    mode: "payment",
                    submit_type: "book",
                    client_reference_id:
                        String(booking.id),
                    success_url:
                        `${returnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url:
                        `${returnUrl}?checkout=cancelled`,
                    expires_at: stripeExpiration,
                    line_items: [
                        {
                            quantity: 1,
                            price_data: {
                                currency:
                                    checkoutCurrency,
                                unit_amount:
                                    checkoutAmount,
                                tax_behavior:
                                    "inclusive",
                                product_data: {
                                    name:
                                        `${booking.holes}-hole tee-time reservation`,
                                    description:
                                        `${booking.players} golfer(s) on ${booking.day} at ${booking.time}`
                                }
                            }
                        }
                    ],
                    metadata: {
                        booking_id:
                            String(booking.id),
                        course_id:
                            String(booking.course_id)
                    },
                    payment_intent_data: {
                        metadata: {
                            booking_id:
                                String(booking.id),
                            course_id:
                                String(booking.course_id)
                        }
                    }
                },
                {
                    idempotencyKey:
                        `coursepilot-booking-${booking.id}-${checkoutAccessToken}`
                }
            );
    } catch (error) {
        console.error(
            "Stripe Checkout creation failed:",
            error instanceof Error
                ? error.message
                : "Unknown Stripe error"
        );

        return jsonResponse(
            origin,
            { error: "Online checkout could not be started." },
            502
        );
    }

    if (!checkoutSession.url) {
        console.error(
            "Stripe Checkout did not return a hosted URL."
        );

        return jsonResponse(
            origin,
            { error: "Online checkout could not be started." },
            502
        );
    }

    const {
        data: updatedBooking,
        error: updateError
    } = await supabaseAdmin
        .from("bookings")
        .update({
            stripe_checkout_session_id:
                checkoutSession.id,
            reservation_expires_at:
                new Date(
                    stripeExpiration * 1000
                ).toISOString()
        })
        .eq("id", booking.id)
        .eq(
            "checkout_access_token",
            checkoutAccessToken
        )
        .eq("payment_status", "pending")
        .eq("reservation_status", "held")
        .select("id")
        .maybeSingle();

    if (updateError || !updatedBooking) {
        console.error(
            "Checkout booking update failed:",
            updateError?.message ||
                "Booking state changed"
        );

        return jsonResponse(
            origin,
            { error: "Online checkout could not be started." },
            409
        );
    }

    return jsonResponse(
        origin,
        { checkout_url: checkoutSession.url }
    );
});
