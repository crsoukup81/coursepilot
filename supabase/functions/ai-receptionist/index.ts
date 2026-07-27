import {
    createClient,
    type SupabaseClient
} from "npm:@supabase/supabase-js@2.110.2";

import {
    corsHeaders
} from "npm:@supabase/supabase-js@2.110.2/cors";

import {
    buildReceptionistInstructions
} from "../_shared/ai-receptionist/prompt.ts";


const OPENAI_MODEL = "gpt-5.6-luna";
const MAX_MESSAGE_LENGTH = 600;
const IP_RATE_LIMIT_WINDOW_SECONDS = 60;
const DAILY_RATE_LIMIT_WINDOW_SECONDS = 86_400;
const DEFAULT_IP_REQUEST_LIMIT = 8;
const DEFAULT_COURSE_DAILY_LIMIT = 250;
const DEFAULT_GLOBAL_DAILY_LIMIT = 1_000;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_ORIGINS =
    new Set<string>([
        "https://crsoukup81.github.io",
        "https://coursepilotgolf.netlify.app",
        "http://127.0.0.1:5173",
        "http://localhost:5173"
    ]);

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


type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
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


function getPositiveIntegerSetting(
    name: string,
    fallback: number,
    maximum: number
) {
    const parsed = Number(Deno.env.get(name));

    return Number.isInteger(parsed) &&
        parsed >= 1 &&
        parsed <= maximum
        ? parsed
        : fallback;
}


async function hashIdentifier(identifier: string) {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(identifier)
    );

    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}


async function consumeRateLimit(
    supabase: SupabaseClient,
    scope: string,
    identifier: string,
    windowSeconds: number,
    requestLimit: number
): Promise<RateLimitResult> {
    const identifierHash = await hashIdentifier(identifier);
    const {
        data,
        error
    } = await supabase.rpc(
        "consume_edge_rate_limit",
        {
            p_scope: scope,
            p_identifier_hash: identifierHash,
            p_window_seconds: windowSeconds,
            p_request_limit: requestLimit
        }
    );

    const result = Array.isArray(data)
        ? data[0]
        : null;

    if (
        error ||
        !result ||
        typeof result.allowed !== "boolean" ||
        typeof result.remaining !== "number" ||
        typeof result.retry_after_seconds !== "number"
    ) {
        throw new Error(
            error?.message || "Invalid rate-limit response."
        );
    }

    return {
        allowed: result.allowed,
        remaining: result.remaining,
        retryAfterSeconds: result.retry_after_seconds
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

    const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const publishableKey = getDefaultKey(
        "SUPABASE_PUBLISHABLE_KEYS",
        "SUPABASE_ANON_KEY"
    );

    const openAiApiKey =
        Deno.env.get("OPENAI_API_KEY");

    if (
        !supabaseUrl ||
        !serviceRoleKey ||
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

    const adminSupabase = createClient(
        supabaseUrl,
        serviceRoleKey,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    );

    const ipRequestLimit = getPositiveIntegerSetting(
        "AI_RATE_LIMIT_PER_MINUTE",
        DEFAULT_IP_REQUEST_LIMIT,
        1_000
    );

    let rateLimitResult: RateLimitResult;

    try {
        rateLimitResult = await consumeRateLimit(
            adminSupabase,
            "ai:ip:minute",
            getClientIdentifier(request),
            IP_RATE_LIMIT_WINDOW_SECONDS,
            ipRequestLimit
        );
    } catch (error) {
        console.error(
            "AI receptionist rate limiter failed:",
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

        const courseDailyLimit = getPositiveIntegerSetting(
            "AI_DAILY_COURSE_LIMIT",
            DEFAULT_COURSE_DAILY_LIMIT,
            100_000
        );
        const globalDailyLimit = getPositiveIntegerSetting(
            "AI_DAILY_GLOBAL_LIMIT",
            DEFAULT_GLOBAL_DAILY_LIMIT,
            100_000
        );

        let courseBudget: RateLimitResult;
        let globalBudget: RateLimitResult;

        try {
            courseBudget = await consumeRateLimit(
                adminSupabase,
                "ai:course:day",
                courseId,
                DAILY_RATE_LIMIT_WINDOW_SECONDS,
                courseDailyLimit
            );

            if (!courseBudget.allowed) {
                return jsonResponse(
                    origin,
                    {
                        error: "This course's receptionist has reached its daily request limit. Please contact the golf course directly.",
                        code: "AI_DAILY_LIMIT_REACHED"
                    },
                    429,
                    {
                        "Retry-After": String(
                            courseBudget.retryAfterSeconds
                        )
                    }
                );
            }

            globalBudget = await consumeRateLimit(
                adminSupabase,
                "ai:global:day",
                "coursepilot-global",
                DAILY_RATE_LIMIT_WINDOW_SECONDS,
                globalDailyLimit
            );
        } catch (error) {
            console.error(
                "AI receptionist budget limiter failed:",
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

        if (!globalBudget.allowed) {
            return jsonResponse(
                origin,
                {
                    error: "The receptionist has reached its daily request limit. Please contact the golf course directly.",
                    code: "AI_DAILY_LIMIT_REACHED"
                },
                429,
                {
                    "Retry-After": String(
                        globalBudget.retryAfterSeconds
                    )
                }
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
