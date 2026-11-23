# LTI 1.3 resource-link launch

The tool supports an instructor or learner opening the integrity studio in a new top-level browser window from a registered course. No institution was registered during development. The local tests exercise the implemented protocol and do not certify a particular LMS.

## Registration

1. Apply `schema.sql` to the deployment database as part of the application's schema migrations.
2. Obtain the LMS issuer, tool client ID, authorization endpoint, JWKS endpoint and installation deployment ID from its administrator. The issuer and endpoints must be HTTPS. Verify them through the administrator's trusted registration channel.
3. Configure the runtime variable `LTI_PLATFORMS` with a JSON array. Each object contains `issuer`, `clientId`, `authUrl`, `jwksUrl` and `deploymentIds` (a nonempty array). Multiple clients under the same issuer require `client_id` on login. The runtime secret `LTI_SUBJECT_KEY` must contain at least 32 bytes. Generate and preserve a random secret per deployment. Changing it changes pseudonymous identities.
4. Open `/lti/config` and enter the URLs manually in the LMS registration form. Initiate login at `/lti/login`. Both the redirect and resource target are `/lti/launch`. Select a resource link and open it in a new window. The standard `document_target` value is `window`. Configure the LMS to send a subject, course role, deployment, resource and, where possible, a course context. Real names and email addresses are optional and discarded. A signed Arabic or English launch locale initializes the studio when the browser has no saved language choice.
5. Test both an actual learner launch and an instructor launch from that LMS. Verify isolation between two courses and between their users before recording institutional acceptance.

The runtime reads trusted keys only from a registered administrator-supplied JWKS endpoint. HTTPS or key retrieval errors, expired tokens, unregistered deployments, missing browser state and unsupported roles stop the launch. Browser session binding uses a Secure, HttpOnly, SameSite=None transaction cookie. A browser with cookies blocked must enable cookies in the tool's top-level window. Course instructor roles never grant institution-wide administration. Resource-link-only integrations do not offer gradebook sync or line-item services.

## Integrate with the application's session layer

Call `handleLti(request, env, {onLaunch})` for incoming requests. It returns `null` for unrelated paths. On success, `onLaunch(principal)` should issue the site's standard session and redirect to the studio. The principal contains the course-scoped role, a pseudonymous user ID and cohort ID. If a course context is absent, the scope narrows to the resource link. Do not replace an LTI cohort with a global evaluator or administrative workspace.

Without any registrations, `GET /lti/config` shows zero registered platforms. Login and callback return `503 lti_platform_registration_required`. The configured route verifies a platform-signed RS256 ID token and retrieves the proposed signing key over TLS. A transaction is consumed once in the database, including simultaneous valid callbacks. Abandoned state expires after ten minutes and the next initiation clears expired rows.

## Verification

Run `node research/lti/test.mjs` with Node 24 and OpenSSL. Each run creates a local TLS endpoint, generates a new signing key and uses a SQLite database. The per-run certificate files are removed on exit. The accompanying `evidence.json` records an executed run. It contains no private keys, cookies, ID tokens or institutional credentials.

Implementation references: [1EdTech LTI Core 1.3](https://www.imsglobal.org/spec/lti/v1p3), [1EdTech Security Framework](https://www.imsglobal.org/spec/security/v1p0), [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html).

### Open edX launch component

The cross-implementation test runs the published Open edX LTI Consumer XBlock with a Django cache and a fresh RSA signing key. The XBlock constructs the login URL, validates the tool return parameters, signs its own launch messages and publishes its own JWKS. Mizan processes the signed form and creates its usual course-scoped session. Two HTTPS servers bind only to loopback and trust a temporary certificate. Cookie jars and an HTML form reader follow the redirects, without simulating a phone or running a full campus LMS.

From the repository root with Node 24, Python 3.12 and OpenSSL:

```sh
python -m venv /tmp/mizan-lti-qa
/tmp/mizan-lti-qa/bin/python -m pip install -r research/lti/requirements-interop.txt
npm run build
/tmp/mizan-lti-qa/bin/python research/lti/test-openedx.py --out /tmp/mizan-openedx-run.json
```

The output records all checks, timestamps, input and Worker digests, and package versions. Use a new output path for each run. The verified Open edX 11.5.1 wheel has SHA-256 `58dcff6ff88814bf48e5433498a90667ed70621c254d6b447ef3c132854e8955`. See the [Open edX component source](https://github.com/openedx/xblock-lti-consumer) and [Open edX administrator guide](https://docs.openedx.org/en/latest/educators/how-tos/course_development/exercise_tools/set_up_lti_1_3_component.html).

For institutional acceptance, an authorized administrator must register the public tool on a campus test tenant. Exercise learner and instructor launches from two test courses, open the generated report and confirm course isolation. Keep campus passwords, private signing keys, cookies and launch assertions outside the acceptance record.
