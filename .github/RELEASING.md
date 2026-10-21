# Release setup

The `release.yml` workflow publishes `QuEraComputing.vscode-stim` when a `v<major>.<minor>.<patch>` tag matching `package.json` is pushed. It tests and packages once, then sends the same VSIX to GitHub Releases, Open VSX, and the VS Code Marketplace. Manual runs on branches do not publish. Selecting `marketplace_setup` disables all publishing, including on tags.

Both registries use short-lived credentials obtained through GitHub Actions OIDC. No `OVSX_PAT`, `VSCE_PAT`, or Azure client secret is needed. Node.js 22 is required by the pinned Open VSX CLI.

## Open VSX

The namespace owner must have accepted the Open VSX publisher agreement and have publishing access to `QuEraComputing`. Under Open VSX account settings, register a trusted publisher with:

| Field | Value |
| --- | --- |
| Provider | GitHub |
| Organization | `QuEraComputing` |
| Repository | `vscode-stim` |
| Workflow | `release.yml` |
| Environment | Leave empty |

The Open VSX job has `id-token: write` and uses `ovsx publish --trusted-publishing`. It has no GitHub environment, matching the registration above. Do not set `OVSX_PAT`: an explicit token takes precedence over trusted publishing.

See [Open VSX trusted publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing).

## VS Code Marketplace

Marketplace access and Entra authentication are separate: a successful Azure login does not grant permission to publish. The Entra service principal must also be a Contributor of the `QuEraComputing` Marketplace publisher.

### 1. Create a GitHub environment

In the repository, open **Settings → Environments** and create `vscode-marketplace`. Under deployment branches and tags, allow the `main` branch for the setup check and tags matching `v*` for releases. Add required reviewers if your release process calls for them.

Only the Marketplace job uses this environment. It gives Entra a stable subject across release tags.

### 2. Create the Entra application and federation

In QuEra's Microsoft Entra tenant, register a single-tenant application for this release pipeline. Record its **Application (client) ID** and **Directory (tenant) ID**. Use the application's service principal; do not create a client secret.

Under **Certificates & secrets → Federated credentials**, add a GitHub Actions credential for this repository and the `vscode-marketplace` environment. If the form requires numeric IDs, the GitHub organization ID is `102835961` and the repository ID is `1295459764`.

| Field | Value |
| --- | --- |
| Issuer | `https://token.actions.githubusercontent.com` |
| Subject | `repo:QuEraComputing/vscode-stim:environment:vscode-marketplace` |
| Audience | `api://AzureADTokenExchange` |

This subject assumes the repository's default, non-immutable OIDC subject format, which was checked during setup. If Entra generates a subject containing numeric organization and repository IDs, use **Edit (optional)** beneath **Subject identifier** to replace it with the exact subject above. If the repository later enables immutable or custom subjects, update the Entra credential to match.

The workflow uses `azure/login` with `allow-no-subscriptions: true`. It does not deploy Azure resources, so this service-principal route does not require an Azure subscription or an Azure subscription Contributor role.

See [Azure Login OIDC setup](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended) and [GitHub OIDC subjects](https://docs.github.com/en/actions/reference/security/oidc).

### 3. Add GitHub configuration

In **Settings → Environments → vscode-marketplace → Environment variables**, add:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_TENANT_ID` | Directory (tenant) ID |

These are identifiers, not access tokens. The workflow reads them through `vars`, not `secrets`.

### 4. Authorize the identity in Marketplace

After the workflow is on `main`, run **Actions → Release → Run workflow**, select `main`, and enable `marketplace_setup`. This runs the tests and packaging, checks Entra login, and prints the service principal's Marketplace identity ID in **Show Marketplace identity ID**. It does not publish to any registry or create a GitHub release.

The ID comes from the Azure DevOps profile API while signed in as the service principal. It is not the application's client ID or Entra object ID. The workflow requests only the ID, not the access token.

As an Owner of the [QuEraComputing publisher](https://marketplace.visualstudio.com/manage/publishers/QuEraComputing), open **Members → Add**, use that identity ID, and assign **Contributor**.

If the profile API cannot resolve the service principal, an Azure DevOps organization administrator may need to add it to a company organization first. Confirm the identity is in the intended tenant and retry the setup check.

See Microsoft's [service-principal publisher membership instructions](https://learn.microsoft.com/en-us/azure/devops/extend/publish/command-line?view=azure-devops#publish-with-a-microsoft-entra-token) for identity lookup, and [VS Code secure publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace) for `vsce --azure-credential`.

## Publish a version

1. Update `package.json` and `package-lock.json` to the next numeric version. Commit and push the changes.
2. Tag that commit `v<version>` and push the tag. For example, version `0.1.1` uses `v0.1.1`.
3. Check the Release workflow: `vsix`, `publish-openvsx`, and `publish-marketplace` must all succeed.
4. Check the public listing in each registry after its validation finishes.

The workflow does not increment versions or create tags. Each registry job can fail independently; a GitHub release alone does not confirm that either registry published successfully. Rerun failed jobs after fixing credentials or permissions. Both CLIs use `--skip-duplicate` so an already published version is not uploaded again. Never move a published version tag to different code; use a new version for changes.

For a local package check, run `npx vsce package -o vscode-stim.vsix` and install the VSIX in VS Code. Keep generated VSIX files out of Git.
