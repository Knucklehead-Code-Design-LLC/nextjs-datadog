const entrypoints = ['.', './client', './instrumentation', './proxy', './server'];

for (const entrypoint of entrypoints) {
  await import(`nextjs-datadog${entrypoint === '.' ? '' : entrypoint.slice(1)}`);
}

console.log(`Imported ${entrypoints.length} package entrypoints successfully.`);
