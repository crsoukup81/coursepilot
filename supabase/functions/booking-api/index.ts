import {
    createClient
} from "npm:@supabase/supabase-js@2.110.2";

import {
    corsHeaders
} from "npm:@supabase/supabase-js@2.110.2/cors";

import {
    BookingProviderError,
    getBookingProvider
} from "../_shared/booking-providers/index.ts";


const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_ORIGINS =
    new Set<string>([
        "https://crsoukup81.github.io",
        "https://coursepilotgolf.netlify.app",
        "http://127.0.0.1:5173",
        "http://localhost:5173"
    ]);


type BookingApiRequest = {
    operation?: unknown;
    course_id?: unknown;
    tee_date?: unknown;
    tee_time?: unknown;
    provider_slot_id?: unknown;
    players?: unknown;
    name?: unknown;
    customer_phone?: unknown;
    holes?: unknown;
    payment_method?: unknown;
};


type BookingIntegration = {
    provider_key: string;
    external_course_id: string | null;
    is_active: boolean;
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


function getDefaultKey(
    currentName: string,
    legacyName: string
) {
    const currentKeys = Deno.env.get(currentName);

    if (currentKeys) {
        try {
            const parsed = JSON.parse(currentKeys);
            const defaultKey = parsed?.default;

            if (
                typeof defaultKey === "string" &&
                defaultKey.trim()
            ) {
                return defaultKey.trim();
            }
        } catch {
            console.error(
                `${currentName} was not valid JSON.`
            );
        }
    }

    return Deno.env.get(legacyName) || null;
}


function getDate(value: unknown) {
    const dateValue = String(value ?? "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return null;
    }

    const date = new Date(`${dateValue}T00:00:00.000Z`);

    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === dateValue
        ? dateValue
        : null;
}


function getTime(value: unknown) {
    const match =
        String(value ?? "")
            .trim()
            .match(/^([01]\d|2[0-3]):([0-5]\d)$/);

    return match
        ? `${match[1]}:${match[2]}`
        : null;
}


function getProviderSlotId(value: unknown) {
    if (
        value === null ||
        value === undefined
    ) {
        return {
            valid: true,
            value: null
        };
    }

    if (typeof value !== "string") {
        return {
            valid: false,
            value: null
        };
    }

    const providerSlotId = value.trim();

    return {
        valid:
            providerSlotId.length >= 1 &&
            providerSlotId.length <= 200,
        value: providerSlotId || null
    };
}


function getOperationErrorMessage(operation: string) {
    return operation === "create_reservation"
        ? "The reservation could not be completed."
        : "Tee-time availability is temporarily unavailable.";
}


Deno.serve(async (request) => {
    const origin =
        request.headers.get("origin") || "";

    if (!ALLOWED_ORIGINS.has(origin)) {
        return new Response(
            JSON.stringify({
                error: "This booking origin is not allowed."
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

    let apiRequest: BookingApiRequest;

    try {
        const requestBody = await request.json();

        if (
            !requestBody ||
            typeof requestBody !== "object" ||
            Array.isArray(requestBody)
        ) {
            throw new Error("Invalid request body.");
        }

        apiRequest = requestBody as BookingApiRequest;
    } catch {
        return jsonResponse(
            origin,
            {
                error: "The booking request was invalid.",
                code: "INVALID_REQUEST"
            },
            400
        );
    }

    const operation =
        String(apiRequest.operation ?? "").trim();

    const courseId =
        String(apiRequest.course_id ?? "").trim();

    const teeDate =
        getDate(apiRequest.tee_date);

    const players =
        Number(apiRequest.players);

    if (
        (
            operation !== "search_availability" &&
            operation !== "create_reservation"
        ) ||
        !UUID_PATTERN.test(courseId) ||
        !teeDate ||
        !Number.isInteger(players) ||
        players < 1 ||
        players > 12
    ) {
        return jsonResponse(
            origin,
            {
                error: "The booking request was invalid.",
                code: "INVALID_REQUEST"
            },
            400
        );
    }

    const teeTime = getTime(apiRequest.tee_time);
    const providerSlot =
        getProviderSlotId(apiRequest.provider_slot_id);
    const customerName =
        typeof apiRequest.name === "string"
            ? apiRequest.name.trim()
            : "";
    const customerPhone =
        typeof apiRequest.customer_phone === "string"
            ? apiRequest.customer_phone.trim()
            : "";
    const holes = Number(apiRequest.holes);
    const paymentMethod =
        typeof apiRequest.payment_method === "string"
            ? apiRequest.payment_method.trim()
            : "";

    if (
        operation === "create_reservation" &&
        (
            !teeTime ||
            !providerSlot.valid ||
            customerName.length < 2 ||
            customerName.length > 100 ||
            !/^\d{3}-\d{3}-\d{4}$/.test(
                customerPhone
            ) ||
            (holes !== 9 && holes !== 18) ||
            (
                paymentMethod !== "pay_at_course" &&
                paymentMethod !== "online"
            )
        )
    ) {
        return jsonResponse(
            origin,
            {
                error: "The reservation request was invalid.",
                code: "INVALID_RESERVATION_REQUEST"
            },
            400
        );
    }

    const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

    const secretKey = getDefaultKey(
        "SUPABASE_SECRET_KEYS",
        "SUPABASE_SERVICE_ROLE_KEY"
    );

    const publishableKey = getDefaultKey(
        "SUPABASE_PUBLISHABLE_KEYS",
        "SUPABASE_ANON_KEY"
    );

    if (
        !supabaseUrl ||
        !secretKey ||
        !publishableKey
    ) {
        console.error(
            "Booking API is missing required server configuration."
        );

        return jsonResponse(
            origin,
            { error: getOperationErrorMessage(operation) },
            500
        );
    }

    const clientOptions = {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    };

    const supabaseAdmin = createClient(
        supabaseUrl,
        secretKey,
        clientOptions
    );

    const supabasePublic = createClient(
        supabaseUrl,
        publishableKey,
        clientOptions
    );

    const {
        data: course,
        error: courseError
    } = await supabaseAdmin
        .from("courses")
        .select("id")
        .eq("id", courseId)
        .maybeSingle();

    if (courseError) {
        console.error(
            "Booking API course lookup failed:",
            courseError.message
        );

        return jsonResponse(
            origin,
            { error: getOperationErrorMessage(operation) },
            500
        );
    }

    if (!course) {
        return jsonResponse(
            origin,
            { error: "This golf course was not found." },
            404
        );
    }

    const {
        data: integration,
        error: integrationError
    } = await supabaseAdmin
        .from("course_booking_integrations")
        .select(
            "provider_key, external_course_id, is_active"
        )
        .eq("course_id", courseId)
        .maybeSingle<BookingIntegration>();

    if (integrationError) {
        console.error(
            "Booking integration lookup failed:",
            integrationError.message
        );

        return jsonResponse(
            origin,
            { error: getOperationErrorMessage(operation) },
            500
        );
    }

    if (
        !integration ||
        !integration.is_active
    ) {
        return jsonResponse(
            origin,
            {
                error: "Online booking is not configured for this course.",
                code: "BOOKING_NOT_CONFIGURED"
            },
            503
        );
    }

    try {
        const provider = getBookingProvider(
            integration.provider_key,
            {
                supabaseClient: supabasePublic,
                externalCourseId:
                    integration.external_course_id
            }
        );

        if (operation === "search_availability") {
            const teeTimes =
                await provider.searchAvailability({
                    courseId,
                    teeDate,
                    players
                });

            return jsonResponse(
                origin,
                {
                    provider: integration.provider_key,
                    tee_times: teeTimes.map((teeTime) => ({
                        time: teeTime.time,
                        remaining_players:
                            teeTime.remainingPlayers,
                        provider_slot_id:
                            teeTime.providerSlotId
                    }))
                }
            );
        }

        const reservation =
            await provider.createReservation({
                courseId,
                teeDate,
                teeTime: teeTime as string,
                providerSlotId: providerSlot.value,
                players,
                customerName,
                customerPhone,
                holes: holes as 9 | 18,
                paymentMethod: paymentMethod as
                    "pay_at_course" | "online"
            });

        return jsonResponse(
            origin,
            {
                provider: integration.provider_key,
                reservation: {
                    booking_id: reservation.bookingId,
                    provider_reservation_id:
                        reservation.providerReservationId,
                    reservation_state:
                        reservation.reservationState,
                    hold_expires_at:
                        reservation.holdExpiresAt,
                    booking_payment_status:
                        reservation.paymentStatus,
                    trusted_price_per_player:
                        reservation.pricePerPlayer,
                    trusted_subtotal:
                        reservation.subtotal,
                    trusted_tax_rate:
                        reservation.taxRate,
                    trusted_tax_amount:
                        reservation.taxAmount,
                    trusted_total: reservation.total,
                    trusted_currency:
                        reservation.currency,
                    checkout_access_token:
                        reservation.checkoutAccessToken
                }
            }
        );
    } catch (error) {
        if (error instanceof BookingProviderError) {
            console.error(
                "Booking provider request failed:",
                error.code
            );

            return jsonResponse(
                origin,
                {
                    error: error.message,
                    code: error.code
                },
                error.status
            );
        }

        console.error(
            "Unexpected booking provider failure:",
            error
        );

        return jsonResponse(
            origin,
            { error: getOperationErrorMessage(operation) },
            500
        );
    }
});
