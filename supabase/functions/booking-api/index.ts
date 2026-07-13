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
        "http://127.0.0.1:5173",
        "http://localhost:5173"
    ]);


type BookingApiRequest = {
    operation?: unknown;
    course_id?: unknown;
    tee_date?: unknown;
    players?: unknown;
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
        apiRequest = await request.json();
    } catch {
        return jsonResponse(
            origin,
            { error: "The availability request was invalid." },
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
        operation !== "search_availability" ||
        !UUID_PATTERN.test(courseId) ||
        !teeDate ||
        !Number.isInteger(players) ||
        players < 1 ||
        players > 12
    ) {
        return jsonResponse(
            origin,
            { error: "The availability request was invalid." },
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
            { error: "Tee-time availability is temporarily unavailable." },
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
            { error: "Tee-time availability is temporarily unavailable." },
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
            { error: "Tee-time availability is temporarily unavailable." },
            500
        );
    }

    if (
        !integration ||
        !integration.is_active
    ) {
        return jsonResponse(
            origin,
            { error: "Tee-time availability is not configured for this course." },
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
    } catch (error) {
        if (error instanceof BookingProviderError) {
            console.error(
                "Booking provider request failed:",
                error.code
            );

            return jsonResponse(
                origin,
                { error: error.message },
                error.status
            );
        }

        console.error(
            "Unexpected booking provider failure:",
            error
        );

        return jsonResponse(
            origin,
            { error: "Tee-time availability is temporarily unavailable." },
            500
        );
    }
});
