# RAF — Personal Media Library

RAF is an open-source desktop library for tracking films, series, anime, donghua, manga, light novels and books. It is designed for one computer and works offline by default. The project is published under the MIT License.

> **Privacy summary:** The local library does not sync to a RAF server. Google sign-in and Discourse forum connections are optional online features; enabling them sends the corresponding authentication or forum data to those services. The in-app privacy notice still has a `.......` data-controller identity placeholder and is a draft, not a ready-made legal policy. The public contact address shown in the app footer is dumanburak777@gmail.com. A distributor must complete the data-controller identity and obtain appropriate legal review before presenting the notice as their own.

## Run from source

Requirements: Node.js 20 or newer, npm, and a desktop environment.

```sh
npm install
npm start
```

Build an installer for the current operating system with the matching `dist:*` script in `package.json`. Windows, macOS and Linux packaging targets are configured; installers still need to be built and signed on their target platforms.

## Local storage and security

- The Electron renderer has no Node.js access, uses context isolation and sandboxing, and is limited by a restrictive Content Security Policy.
- Renderer network requests are blocked. No analytics, advertising, sync or RAF server is used.
- Each local account is device-specific. Passwords are never stored; scrypt derives a key and the app verifies a keyed digest with a timing-safe comparison. Five failed sign-in attempts trigger a temporary process-local delay.
- Library records are encrypted with AES-256-GCM and stored under Electron's per-user data directory in `RAFData/accounts/<account-id>/library/<media-type>/records.enc`.
- Account index metadata (email, name, salt and password verifier) is local and not encrypted. Restrict access to your operating-system user account.
- There is no password-reset or account-recovery service. Losing a local password means the encrypted library cannot be opened. Back up regularly.
- Export files are unencrypted JSON at a path the user chooses. Keep backups somewhere private.

The exact data directory is the `RAFData` folder inside Electron's `app.getPath('userData')` directory. Uninstallers may leave it behind.

## Optional online connections

These are separate from the offline library and require a deliberate user action.

- Google sign-in: configure an OAuth 2.0 **Desktop app** client ID in Google Cloud Console. The app contacts Google for sign-in and account profile verification. The RAF library remains encrypted on the same computer. The user also chooses a local vault password so offline sign-in remains possible. The OAuth client ID is public configuration and is not a client secret.
- Discourse forum: enter a Discourse HTTPS origin and approve RAF's user API key request on that forum. RAF asks for read/write scopes to list and send private-message topics. Forum room names, participants and messages are stored by that forum service, outside this device. Disconnecting attempts to revoke the key.

Online data is subject to Google's and the selected forum's own terms and privacy policies. No other forum software is currently supported.

## Languages

Turkish is the primary interface language. English is available in the interface language selector. Media titles and notes remain exactly as entered. Privacy, terms, and rights notices are available in Turkish and English.

## Legal notice

The in-app privacy notice describes this local-first implementation and contains links to official KVKK sources. It still includes a `.......` data-controller identity placeholder and is not legal advice or a complete compliance package. Complete that identity and obtain jurisdiction-specific legal review before distributing the app under an organization or collecting data from others. A personal offline installation has no central RAF account database. Google and forum connections are optional; when enabled, data is sent to the selected service as described above.

## License

MIT. See [LICENSE](LICENSE).
