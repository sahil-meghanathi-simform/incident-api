import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const offsetQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export function offsetEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
  });
}

/**
 * Express 5's default query parser is `simple` (build-plan.md finding B6), which
 * splits repeated keys (`?severity=LOW&severity=HIGH`) into an array but never splits
 * a single comma-separated value on its own. Accept both spellings so either
 * frontend-encoding choice works, rather than committing every caller to one.
 */
export function csvArrayQueryParam<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined) return undefined;
    const raw = Array.isArray(value) ? value : [value];
    return raw.flatMap((item) => (typeof item === 'string' ? item.split(',') : item)).filter((v) => v !== '');
  }, z.array(schema).optional());
}

/** `z.coerce.boolean()` treats the string "false" as truthy — this maps it correctly. */
export function booleanQueryParam() {
  return z.preprocess((value) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }, z.boolean().optional());
}

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export function cursorEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}
