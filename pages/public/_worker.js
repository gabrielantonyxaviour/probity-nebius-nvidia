// Cloudflare Pages front: probity.pages.dev is the only public address. Every request goes to the web Worker over a service binding.
export default { fetch: (req, env) => env.APP.fetch(req) };
