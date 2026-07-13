import {
    BookingProviderError,
    type AvailableTeeTime,
    type BookingProvider,
    type BookingProviderContext
} from "./types.ts";


type NativeAvailabilityRow = {
    slot_time?: unknown;
    remaining_players?: unknown;
};


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
        }
    };
}
