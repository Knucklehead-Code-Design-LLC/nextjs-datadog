# Releasing

Releases use Changesets, GitHub Actions, npm provenance, and npm trusted
publishing. Long-lived npm tokens are not part of the release design.

## Contributor workflow

Every user-visible change must include a changeset:

```bash
npm run changeset
```

Choose `patch`, `minor`, or `major` according to semantic versioning and write a
consumer-facing summary.

## Maintainer workflow

1. Merge normal changes with their changesets into `main`.
2. The release workflow opens or updates a version pull request.
3. Review the generated version, changelog, and lockfile, then merge the version
   pull request.
4. The workflow verifies the exact source and publishes the package to npm with
   provenance.
5. Confirm the npm package page, provenance statement, and GitHub release.

The root package is intentionally listed as the `.` npm workspace. Changesets
only versions packages listed in a workspace when a workspace configuration is
present, so removing that entry would exclude `nextjs-datadog` from releases.
The private demo uses `nextjs-datadog: "*"` so npm links the current root
workspace and Changesets can validate the dependency at every package version.

## Initial npm bootstrap

npm trusted publishing can only be configured after the package exists. A
maintainer must perform the first publish from a verified local checkout:

1. Merge the initial package implementation to `main`, leaving its version at
   `0.0.0`.
2. Confirm the `nextjs-datadog` npm name is still available.
3. Run `npm ci`, `npm run verify`, and inspect `npm pack --dry-run`.
4. Using a short-lived authenticated npm session, create the package without
   making the bootstrap version `latest`:

   ```bash
   npm publish --access public --tag bootstrap
   ```

5. On npm, configure GitHub Actions as a trusted publisher for:
   - organization: `Knucklehead-Code-Design-LLC`
   - repository: `nextjs-datadog`
   - workflow: `release.yml`
6. Require the `npm` GitHub environment for releases and add reviewer
   protection if desired.
7. Merge the initial Changesets version pull request. GitHub Actions publishes
   `0.1.0` as `latest` with npm provenance.
8. Remove the temporary `bootstrap` dist-tag and any local npm credential used
   for the one-time package creation.

After bootstrap, releases must use the trusted-publishing workflow.

## Recovery

npm versions are immutable. Do not overwrite or reuse a released version. If a
release is defective, deprecate it when appropriate, prepare a corrective
changeset, and publish a new version.
