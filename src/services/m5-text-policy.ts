import { z } from 'zod';

const URL_STYLE_LOCATION_PATTERN = /(^|[^\p{L}\p{N}])(?:www\.|[a-z][a-z0-9+.-]*:)(?=\S)/iu;
const ABSOLUTE_LOCATION_PATTERN =
  /(^|[^\p{L}\p{N}._/\\-])(?:[a-z]:[\\/]|[\\/]{2}|[\\/](?![\\/])|~[\\/])/iu;

export const M5_TEXT_SCHEMA = z
  .string()
  .transform((value, context) => {
    const normalized = value.replace(/\r\n?/gu, '\n').trim();
    if (URL_STYLE_LOCATION_PATTERN.test(normalized) || ABSOLUTE_LOCATION_PATTERN.test(normalized)) {
      context.addIssue({
        code: 'custom',
        message: 'Absolute locations are not allowed in Milestone 5 text.',
      });
      return z.NEVER;
    }
    return normalized;
  })
  .pipe(z.string().min(1).max(4096));

export const M5_SHORT_TEXT_SCHEMA = M5_TEXT_SCHEMA.pipe(z.string().max(512));
