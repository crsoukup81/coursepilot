import {
    createClient
} from "npm:@supabase/supabase-js@2.110.2";

import {
    corsHeaders
} from "npm:@supabase/supabase-js@2.110.2/cors";

import {
    buildReceptionistInstructions
} from "../_shared/ai-receptionist/prompt.ts";


const OPENAI_MODEL = "gpt-5.6-luna";
const MAX_MESSAGE_LENGTH = 600;
const RATE_LIMIT_REQUESTS = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_ORIGINS =
    new Set<string>([
        "https://crsoukup81.github.io",
        "https://coursepilotgolf.netlify.app",
        "http://127.0.0.1:5173",
        "http://localhost:5173"
    ]);

const rateLimitBuckets =
    new Map<string, {
        count: number;
        resetAt: number;
    }>();


type ReceptionistRequest = {
    course_id?: unknown;
    message?: unknown;
};


type PublicCourseSettings = {
    timezone: string;
    booking_start_time: string;
    booking_end_time: string;
    max_players: number | string;
    price_9_holes: number | string;
    price_18_holes: number | string;
    sales_tax_rate: number | string;
    currency: string;
};


type OpenAIResponse = {
    output_text?: unknown;
    output?: Array<{
        type?: unknown;
        content?: Array<{
            type?: unknown;
            text?: unknown;
        }>;
    }>;
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
    status = 200,
    extraHeaders: Record<string, string> = {}
) {
    return new Response(
        JSON.stringify(body),
        {
            status,
            headers: {
                ...getResponseHeaders(origin),
                ...extraHeaders
            }
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


function getClientIdentifier(request: Request) {
    const connectingIp =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-real-ip") ||
        request.headers.get("x-forwarded-for")
            ?.split(",")[0]
            ?.trim();

    return connectingIp || "unknown";
}


function getRateLimitResult(identifier: string) {
    const now = Date.now();
    const bucket = rateLimitBuckets.get(identifier);

    if (!bucket || bucket.resetAt <= now) {
        rateLimitBuckets.set(
            identifier,
            {
                count: 1,
                resetAt: now + RATE_LIMIT_WINDOW_MS
            }
        );

        return {
            allowed: true,
            retryAfterSeconds: 0
        };
    }

    if (bucket.count >= RATE_LIMIT_REQUESTS) {
        return {
            allowed: false,
            retryAfterSeconds: Math.max(
                1,
                Math.ceil((bucket.resetAt - now) / 1000)
            )
        };
    }

    bucket.count += 1;

    if (rateLimitBuckets.size > 1_000) {
        for (const [key, value] of rateLimitBuckets) {
            if (value.resetAt <= now) {
                rateLimitBuckets.delete(key);
            }
        }
    }

    return {
        allowed: true,
        retryAfterSeconds: 0
    };
}


function getOutputText(response: OpenAIResponse) {
    if (
        typeof response.output_text === "string" &&
        response.output_text.trim()
    ) {
        return response.output_text.trim();
    }

    const outputText = (response.output ?? [])
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .filter((content) => content.type === "output_text")
        .map((content) =>
            typeof content.text === "string"
                ? content.text.trim()
                : ""
        )
        .filter(Boolean)
        .join("\n");

    return outputText || null;
}


Deno.serve(async (request) => {
    const origin =
        request.headers.get("origin") || "";

    if (!ALLOWED_ORIGINS.has(origin)) {
        return new Response(
            JSON.stringify({
                error: "This receptionist origin is not allowed."
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

    const rateLimitResult =
        getRateLimitResult(
            getClientIdentifier(request)
        );

    if (!rateLimitResult.allowed) {
        return jsonResponse(
            origin,
            {
                error: "Too many receptionist requests. Please try again shortly.",
                code: "RATE_LIMITED"
            },
            429,
            {
                "Retry-After": String(
                    rateLimitResult.retryAfterSeconds
                )
            }
        );
    }

    let receptionistRequest: ReceptionistRequest;

    try {
        const requestBody = await request.json();

        if (
            !requestBody ||
            typeof requestBody !== "object" ||
            Array.isArray(requestBody)
        ) {
            throw new Error("Invalid request body.");
        }

        receptionistRequest =
            requestBody as ReceptionistRequest;
    } catch {
        return jsonResponse(
            origin,
            {
                error: "The receptionist request was invalid.",
                code: "INVALID_REQUEST"
            },
            400
        );
    }

    const courseId =
        String(receptionistRequest.course_id ?? "")
            .trim();

    const message =
        typeof receptionistRequest.message === "string"
            ? receptionistRequest.message.trim()
            : "";

    if (
        !UUID_PATTERN.test(courseId) ||
        !message ||
        message.length > MAX_MESSAGE_LENGTH
    ) {
        return jsonResponse(
            origin,
            {
                error: "The receptionist request was invalid.",
                code: "INVALID_REQUEST"
            },
            400
        );
    }

    const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

    const publishableKey = getDefaultKey(
        "SUPABASE_PUBLISHABLE_KEYS",
        "SUPABASE_ANON_KEY"
    );

    const openAiApiKey =
        Deno.env.get("OPENAI_API_KEY");

    if (
        !supabaseUrl ||
        !publishableKey ||
        !openAiApiKey
    ) {
        console.error(
            "AI receptionist is missing required server configuration."
        );

        return jsonResponse(
            origin,
            {
                error: "The receptionist is temporarily unavailable.",
                code: "RECEPTIONIST_UNAVAILABLE"
            },
            503
        );
    }

    const supabase = createClient(
        supabaseUrl,
        publishableKey,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    );

    try {
        const {
            data: course,
            error: courseError
        } = await supabase
            .from("courses")
            .select("id, name")
            .eq("id", courseId)
            .maybeSingle();

        if (courseError) {
            console.error(
                "AI receptionist course lookup failed:",
                courseError.message
            );

            return jsonResponse(
                origin,
                {
                    error: "The receptionist is temporarily unavailable.",
                    code: "RECEPTIONIST_UNAVAILABLE"
                },
                503
            );
        }

        if (!course) {
            return jsonResponse(
                origin,
                {
                    error: "This golf course was not found.",
                    code: "COURSE_NOT_FOUND"
                },
                404
            );
        }

        const {
            data: settings,
            error: settingsError
        } = await supabase
            .from("course_public_settings")
            .select(
                "timezone, booking_start_time, booking_end_time, max_players, price_9_holes, price_18_holes, sales_tax_rate, currency"
            )
            .eq("course_id", courseId)
            .maybeSingle<PublicCourseSettings>();

        if (settingsError) {
            console.error(
                "AI receptionist settings lookup failed:",
                settingsError.message
            );

            return jsonResponse(
                origin,
                {
                    error: "The receptionist is temporarily unavailable.",
                    code: "RECEPTIONIST_UNAVAILABLE"
                },
                503
            );
        }

        const maxPlayers = Number(settings?.max_players);
        const priceNineHoles =
            Number(settings?.price_9_holes);
        const priceEighteenHoles =
            Number(settings?.price_18_holes);
        const salesTaxRate =
            Number(settings?.sales_tax_rate);
        const currency =
            String(settings?.currency ?? "")
                .trim()
                .toLowerCase();

        if (
            !settings ||
            !settings.timezone ||
            !settings.booking_start_time ||
            !settings.booking_end_time ||
            !Number.isInteger(maxPlayers) ||
            maxPlayers < 1 ||
            !Number.isFinite(priceNineHoles) ||
            priceNineHoles <= 0 ||
            !Number.isFinite(priceEighteenHoles) ||
            priceEighteenHoles <= 0 ||
            !Number.isFinite(salesTaxRate) ||
            salesTaxRate < 0 ||
            salesTaxRate > 0.25 ||
            !/^[a-z]{3}$/.test(currency)
        ) {
            console.error(
                "AI receptionist course settings were incomplete."
            );

            return jsonResponse(
                origin,
                {
                    error: "The receptionist is temporarily unavailable.",
                    code: "RECEPTIONIST_UNAVAILABLE"
                },
                503
            );
        }

        const instructions =
            buildReceptionistInstructions({
                courseName: String(course.name).trim(),
                timezone: settings.timezone,
                bookingStartTime:
                    settings.booking_start_time,
                bookingEndTime:
                    settings.booking_end_time,
                maxPlayers,
                priceNineHoles,
                priceEighteenHoles,
                salesTaxRate,
                currency
            });

        const openAiResponse = await fetch(
            "https://api.openai.com/v1/responses",
            {
                method: "POST",
                headers: {
                    "Authorization":
                        `Bearer ${openAiApiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: OPENAI_MODEL,
                    reasoning: {
                        effort: "low"
                    },
                    instructions,
                    input: message,
                    max_output_tokens: 300,
                    store: false
                }),
                signal: AbortSignal.timeout(20_000)
            }
        );

        if (!openAiResponse.ok) {
            console.error(
                "OpenAI receptionist request failed:",
                openAiResponse.status,
                openAiResponse.headers.get("x-request-id")
            );

            return jsonResponse(
                origin,
                {
                    error: "The receptionist is temporarily unavailable.",
                    code: "RECEPTIONIST_UNAVAILABLE"
                },
                502
            );
        }

        const responseBody =
            await openAiResponse.json() as OpenAIResponse;

        const answer = getOutputText(responseBody);

        if (!answer) {
            console.error(
                "OpenAI receptionist response contained no text."
            );

            return jsonResponse(
                origin,
                {
                    error: "The receptionist is temporarily unavailable.",
                    code: "RECEPTIONIST_UNAVAILABLE"
                },
                502
            );
        }

        return jsonResponse(
            origin,
            { answer }
        );
    } catch (error) {
        console.error(
            "Unexpected AI receptionist failure:",
            error instanceof Error
                ? error.message
                : "Unknown error"
        );

        return jsonResponse(
            origin,
            {
                error: "The receptionist is temporarily unavailable.",
                code: "RECEPTIONIST_UNAVAILABLE"
            },
            503
        );
    }
});
