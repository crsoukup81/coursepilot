import {
    createCoursePilotProvider
} from "./coursepilot.ts";

import {
    BookingProviderError,
    type BookingProvider,
    type BookingProviderContext
} from "./types.ts";


export {
    BookingProviderError,
    type AvailableTeeTime,
    type BookingProvider,
    type BookingProviderContext,
    type SearchAvailabilityInput
} from "./types.ts";


export function getBookingProvider(
    providerKey: string,
    context: BookingProviderContext
): BookingProvider {
    switch (providerKey) {
        case "coursepilot":
            return createCoursePilotProvider(context);

        default:
            throw new BookingProviderError(
                "PROVIDER_NOT_SUPPORTED",
                "Tee-time availability is not configured for this course.",
                503
            );
    }
}
