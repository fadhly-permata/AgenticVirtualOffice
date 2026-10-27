export type Locale = 'id' | 'en';

/** Satu teks, dua bahasa: [Indonesia, Inggris]. */
export type Pair = readonly [id: string, en: string];

export type Catalog = Record<string, Pair>;

export type Params = Record<string, string | number>;
