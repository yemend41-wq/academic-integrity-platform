# LTI 1.3 resource-link launch

The tool supports an instructor or learner opening the integrity studio in a new top-level browser window from a registered course. No institution was registered during development. The local tests exercise the implemented protocol and do not certify a particular LMS.

## Registration

1. Apply `schema.sql` to the deployment database as part of the application's schema migrations.
2. Obtain the LMS issuer, tool client ID, authorization endpoint, JWKS endpoint and installation deployment ID from its administrator. The issuer and endpoints must be HTTPS. Verify them through the administrator's trusted registration channel.
3. Configure the runtime variable `LTI_PLATFORMS` with a JSON array. Each object contains `issuer`, `clientId`, `authUrl`, `jwksUrl` and `deploymentIds` (a nonempty array). Multiple clients under the same issuer require `client_id` on login. The runtime secret `LTI_SUBJECT_KEY` must contain at least 32 bytes. Generate and preserve a random secret per deployment. Changing it changes pseudonymous identities.
4. Register the URLs returned by the deployed `/lti/config` endpoint. Initiate login at `/lti/login`. Both the redirect and resource target are `/lti/launch`. Select resource-link, top-level or new-window presentation. Configure the LMS to send subject, course role, deployment, resource and, where possible, course context. The application needs neither a real name nor an email.
5. Test both an actual learner launch and an instructor launch from that LMS. Verify isolation between two courses and between their users before recording institutional acceptance.

The runtime reads trusted keys only from a registered administrator-supplied JWKS endpoint. HTTPS or key retrieval errors, expired tokens, unregistered deployments, missing browser state and unsupported roles stop the launch. Browser session binding uses a Secure, HttpOnly, SameSite=None transaction cookie. A browser with cookies blocked must enable cookies in the tool's top-level window. Course instructor roles never grant institution-wide administration. Resource-link-only integrations do not offer gradebook sync or line-item services.

## Integrate with the application's session layer

Call `handleLti(request, env, {onLaunch})` for incoming requests. It returns `null` for unrelated paths. On success, `onLaunch(principal)` should issue the site's standard session and redirect to the studio. The principal contains the course-scoped role, a pseudonymous user ID and cohort ID. If a course context is absent, the scope narrows to the resource link. Do not replace an LTI cohort with a global evaluator or administrative workspace.

Without any registrations, `GET /lti/config` shows zero registered platforms. Login and callback return `503 lti_platform_registration_required`. The configured route verifies a platform-signed RS256 ID token and retrieves the proposed signing key over TLS. A transaction is consumed once in the database, including simultaneous valid callbacks. Abandoned state expires after ten minutes and the next initiation clears expired rows.

## Verification

Run `node research/lti/test.mjs` with Node 24 and OpenSSL. Each run creates a local TLS endpoint, generates a new signing key and uses a SQLite database. The per-run certificate files are removed on exit. The accompanying `evidence.json` records an executed run. It contains no private keys, cookies, ID tokens or institutional credentials.

Implementation references: [1EdTech LTI Core 1.3](https://www.imsglobal.org/spec/lti/v1p3), [1EdTech Security Framework](https://www.imsglobal.org/spec/security/v1p0), [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html).
