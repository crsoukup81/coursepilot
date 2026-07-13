import type {
    SupabaseClient
} from "npm:@supabase/supabase-js@2.110.2";


export type SearchAvailabilityInput = {
    courseId: string;
    teeDate: string;
    players: number;
};


export type AvailableTeeTime = {
    time: string;
    remainingPlayers: number;
    providerSlotId: string | null;
};


export type BookingProviderContext = {
    supabaseClient: SupabaseClient;
    externalCourseId: string | null;
};


export interface BookingProvider {
    searchAvailability(
        input: SearchAvailabilityInput
    ): Promise<AvailableTeeTime[]>;
}


export class BookingProviderError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(
        code: string,
        message: string,
        status = 502
    ) {
        super(message);

        this.name = "BookingProviderError";
        this.code = code;
        this.status = status;
    }
}
