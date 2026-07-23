import { normalizeUnifiedServiceTags } from './internal/config';

export type {
  TelemetryAttributes,
  TelemetryAttributeValue,
  TraceIdentifiers,
  UnifiedServiceTags,
} from './types';

export const defineUnifiedServiceTags = normalizeUnifiedServiceTags;
