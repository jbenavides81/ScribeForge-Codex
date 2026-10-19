// Small helpers for plain-language messages.

/** "1 page", "3 pages", "2 boxes" (with the plural given). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
