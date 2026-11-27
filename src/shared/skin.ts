export type SkinModel = 'classic' | 'slim';
export interface SkinSelection {
    png: string;
    model: SkinModel;
}
export interface SkinProfile {
    accountId: string;
    model: SkinModel;
    capes: {
        id: string;
        name: string;
        active: boolean;
    }[];
}
