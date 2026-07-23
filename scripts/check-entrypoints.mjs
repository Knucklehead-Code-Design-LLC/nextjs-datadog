const entrypoints = ['.', './client', './instrumentation', './proxy', './server'];

for (const entrypoint of entrypoints) {
  let packageEntrypoint = 'nextjs-datadog';

  if (entrypoint !== '.') {
    packageEntrypoint += entrypoint.slice(1);
  }

  await import(packageEntrypoint);
}

console.log(`Imported ${entrypoints.length} package entrypoints successfully.`);
