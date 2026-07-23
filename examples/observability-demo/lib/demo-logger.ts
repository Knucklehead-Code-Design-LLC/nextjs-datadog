import {
  createDatadogLogger,
  type DatadogLogLevel,
  type DatadogLogRecord,
  type DatadogLogger,
} from 'nextjs-datadog/server';

import { demoTags } from './demo-config';
import { addPreviewLog } from './telemetry-store';

const writePreviewLog = (level: DatadogLogLevel, record: Readonly<DatadogLogRecord>): void => {
  addPreviewLog(record);

  const serializedRecord = JSON.stringify(record);
  if (level === 'error') {
    console.error(serializedRecord);
    return;
  }

  if (level === 'warn') {
    console.warn(serializedRecord);
    return;
  }

  console.info(serializedRecord);
};

export const demoLogger: DatadogLogger = createDatadogLogger({
  ...demoTags,
  write: writePreviewLog,
});
