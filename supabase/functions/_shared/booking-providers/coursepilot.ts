import {
    BookingProviderError,
    type AvailableTeeTime,
    type BookingProvider,
    type BookingProviderContext,
    type ReservationResult
} from "./types.ts";


type NativeAvailabilityRow = {
    slot_time?: unknown;
    remaining_players?: unknown;
};


type NativeReservationRow = {
    booking_id?: unknown;
    reservation_state?: unknown;
    hold_expires_at?: unknown;
    booking_payment_status?: unknown;
    trusted_price_per_player?: unknown;
    trusted_subtotal?: unknown;
    trusted_tax_rate?: unknown;
    trusted_tax_amount?: unknown;
    trusted_total?: unknown;
    trusted_currency?: unknown;
    checkout_access_token?: unknown;
};


const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


const AVAILABILITY_ERROR_MESSAGES = [
    "tee time no longer has enough capacity",
    "tee time is blocked",
    "tee time does not exist",
    "tee time has already passed"
];


const REQUEST_ERROR_MESSAGES = [
    "customer name must contain",
    "customer phone number must use",
    "round length must be",
    "invalid payment method",
    "course settings were not found",
    "invalid number of golfers",
    "selected date has already passed"
];


function normalizeTime(value: unknown) {
    const match =
        String(value ?? "")
            .match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);

    return match
        ? `${match[1]}:${match[2]}`
        : null;
}


function normalizeAvailabilityRow(
    value: unknown
): AvailableTeeTime {
    if (
        !value ||
        typeof value !== "object"
    ) {
        throw new BookingProviderError(
            "INVALID_PROVIDER_RESPONSE",
            "Tee-time availability is temporarily unavailable."
        );
    }

    const row = value as NativeAvailabilityRow;
    const time = normalizeTime(row.slot_time);
    const remainingPlayers = Number(row.remaining_players);

    if (
        !time ||
        !Number.isInteger(remainingPlayers) ||
        remainingPlayers < 0
    ) {
        throw new BookingProviderError(
            "INVALID_PROVIDER_RESPONSE",
            "Tee-time availability is temporarily unavailable."
        );
    }

    return {
        time,
        remainingPlayers,
        providerSlotId: null
    };
}


function normalizeNonNegativeNumber(value: unknown) {
    const numberValue = Number(value);

    return Number.isFinite(numberValue) &&
        numberValue >= 0
        ? numberValue
        : null;
}


function normalizeTimestamp(value: unknown) {
    if (
        typeof value !== "string" ||
        !value.trim()
    ) {
        return null;
    }

    const timestamp = value.trim();

    return Number.isNaN(Date.parse(timestamp))
        ? null
        : timestamp;
}


function normalizeReservationRow(
    value: unknown
): ReservationResult {
    if (
        !value ||
        typeof value !== "object"
    ) {
        throw new BookingProviderError(
            "INVALID_PROVIDER_RESPONSE",
            "The reservation could not be confirmed."
        );
    }

    const row = value as NativeReservationRow;
    const bookingId = String(row.booking_id ?? "").trim();
    const reservationState =
        String(row.reservation_state ?? "");
    const paymentStatus =
        String(row.booking_payment_status ?? "");
    const holdExpiresAt =
        normalizeTimestamp(row.hold_expires_at);
    const pricePerPlayer =
        normalizeNonNegativeNumber(
            row.trusted_price_per_player
        );
    const subtotal =
        normalizeNonNegativeNumber(row.trusted_subtotal);
    const taxRate =
        normalizeNonNegativeNumber(row.trusted_tax_rate);
    const taxAmount =
        normalizeNonNegativeNumber(row.trusted_tax_amount);
    const total =
        normalizeNonNegativeNumber(row.trusted_total);
    const currency =
        String(row.trusted_currency ?? "")
            .trim()
            .toLowerCase();
    const checkoutAccessToken =
        row.checkout_access_token === null ||
        row.checkout_access_token === undefined
            ? null
            : String(row.checkout_access_token).trim();

    const validHeldReservation =
        reservationState === "held" &&
        paymentStatus === "pending" &&
        holdExpiresAt !== null &&
        checkoutAccessToken !== null &&
        UUID_PATTERN.test(checkoutAccessToken);

    const validReservedReservation =
        reservationState === "reserved" &&
        paymentStatus === "unpaid" &&
        row.hold_expires_at === null &&
        checkoutAccessToken === null;

    if (
        !/^[1-9]\d{0,18}$/.test(bookingId) ||
        (!validHeldReservation &&
            !validReservedReservation) ||
        pricePerPlayer === null ||
        subtotal === null ||
        taxRate === null ||
        taxAmount === null ||
        total === null ||
        !/^[a-z]{3}$/.test(currency)
    ) {
        throw new BookingProviderError(
            "INVALID_PROVIDER_RESPONSE",
            "The reservation could not be confirmed."
        );
    }

    return {
        bookingId,
        providerReservationId: null,
        reservationState,
        holdExpiresAt,
        paymentStatus,
        pricePerPlayer,
        subtotal,
        taxRate,
        taxAmount,
        total,
        currency,
        checkoutAccessToken
    };
}


function getReservationError(error: {
    code?: string;
    message?: string;
}) {
    const message =
        String(error.message ?? "").toLowerCase();

    if (
        AVAILABILITY_ERROR_MESSAGES.some(
            (candidate) => message.includes(candidate)
        )
    ) {
        return new BookingProviderError(
            "AVAILABILITY_CHANGED",
            "That tee time is no longer available.",
            409
        );
    }

    if (
        REQUEST_ERROR_MESSAGES.some(
            (candidate) => message.includes(candidate)
        )
    ) {
        return new BookingProviderError(
            "INVALID_RESERVATION_REQUEST",
            "The reservation request was invalid.",
            400
        );
    }

    return new BookingProviderError(
        "PROVIDER_UNAVAILABLE",
        "The reservation could not be completed."
    );
}


export function createCoursePilotProvider(
    context: BookingProviderContext
): BookingProvider {
    return {
        async searchAvailability(input) {
            const {
                data,
                error
            } = await context.supabaseClient.rpc(
                "get_available_tee_times",
                {
                    p_course_id: input.courseId,
                    p_tee_date: input.teeDate,
                    p_players: input.players
                }
            );

            if (error) {
                console.error(
                    "Native availability lookup failed:",
                    error.message
                );

                throw new BookingProviderError(
                    "PROVIDER_UNAVAILABLE",
                    "Tee-time availability is temporarily unavailable."
                );
            }

            if (!Array.isArray(data)) {
                throw new BookingProviderError(
                    "INVALID_PROVIDER_RESPONSE",
                    "Tee-time availability is temporarily unavailable."
                );
            }

            return data.map(normalizeAvailabilityRow);
        },

        async createReservation(input) {
            const {
                data,
                error
            } = await context.supabaseClient.rpc(
                "create_booking_reservation",
                {
                    p_course_id: input.courseId,
                    p_tee_date: input.teeDate,
                    p_tee_time: input.teeTime,
                    p_players: input.players,
                    p_name: input.customerName,
                    p_customer_phone: input.customerPhone,
                    p_holes: input.holes,
                    p_payment_method: input.paymentMethod
                }
            );

            if (error) {
                console.error(
                    "Native reservation request failed:",
                    error.code || "UNKNOWN"
                );

                throw getReservationError(error);
            }

            const reservation =
                Array.isArray(data)
                    ? data[0]
                    : data;

            return normalizeReservationRow(reservation);
        }
    };
}
