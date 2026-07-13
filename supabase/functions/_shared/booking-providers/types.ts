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


export type CreateReservationInput = {
    courseId: string;
    teeDate: string;
    teeTime: string;
    providerSlotId: string | null;
    players: number;
    customerName: string;
    customerPhone: string;
    holes: 9 | 18;
    paymentMethod: "pay_at_course" | "online";
};


export type ReservationResult = {
    bookingId: string;
    providerReservationId: string | null;
    reservationState: "held" | "reserved";
    holdExpiresAt: string | null;
    paymentStatus: "pending" | "unpaid";
    pricePerPlayer: number;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    currency: string;
    checkoutAccessToken: string | null;
};


export type BookingProviderContext = {
    supabaseClient: SupabaseClient;
    externalCourseId: string | null;
};


export interface BookingProvider {
    searchAvailability(
        input: SearchAvailabilityInput
    ): Promise<AvailableTeeTime[]>;

    createReservation(
        input: CreateReservationInput
    ): Promise<ReservationResult>;
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
