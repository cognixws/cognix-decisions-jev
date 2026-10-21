# picode-decisions-jev

A COGNIX[WS] extension: TypeSafe's **Jev** answers COGNIX[WS]'s *fast
decisions* — which element of a page matches what an agent described, and
yes/no questions about a page — so your agents' browser acts in a fraction of
a second instead of reading the whole page every step.

## What you need

- COGNIX[WS] with manifest version 11 (Settings ▸ Helper model).
- Node.js on the computer that runs COGNIX[WS].
- A TypeSafe API key, from [console.typesafe.ai/keys](https://console.typesafe.ai/keys).

## Install

1. In COGNIX[WS], open **Settings ▸ Helper model** and press **Add** next to
   Jev, or open **Extensions ▸ Add** and enter
   `https://github.com/cognixws/picode-decisions-jev`.
2. Review what it adds and install it.
3. On the extension's page, paste your TypeSafe API key.
4. In **Settings ▸ Helper model**, choose **Jev (TypeSafe)** and press
   **Test**.

Agents you start afterwards get `find`, `check` and `target` in their
browser tool.

## What it sends

The text of the page the agent asks about (its accessibility outline: roles
and names, not field values), with what looks like a credential masked by
COGNIX[WS] before it leaves the computer, and the question. To locate things
on screen it can also send a screenshot. It goes to `api.typesafe.ai`; see
TypeSafe's [privacy policy](https://typesafe.ai/legal/privacy-policy). The API
key stays in the extension's encrypted settings.

## Settings

| Setting | Meaning |
|---|---|
| TypeSafe API key | Required. |
| Model | `jev-latest` (stable, default) or `jev-preview` (newest; the only one that locates things in screenshots). |

## How it works

`server.mjs` (no dependencies) serves two paths behind COGNIX[WS]'s process
relay: `POST /decide` adds the key and model and forwards the System One
request to TypeSafe over one kept-alive connection; `GET /status` reports
`ready`, `needs-setup` (no key) or `needs-attention` (the last call was
refused). A request past what the model reads at once (about 32 thousand
tokens) answers 413, and COGNIX[WS] asks again with less of the page.
COGNIX[WS] checks every answer before a tool acts on it.

## License

Apache-2.0.
