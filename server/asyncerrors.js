// Express 4 does not notice when an async route handler's promise rejects:
// the error goes nowhere and the request hangs until the client gives up.
// This makes app.get / app.post / app.use wrap each handler so a thrown error
// or a rejected promise goes to the error-handling middleware instead.
//
// Error handlers (four arguments) and non-function arguments (paths, and
// app.get('setting') reads) pass through untouched.

export function catchAsyncErrors(app) {
  for (const method of ['get', 'post', 'use']) {
    const original = app[method].bind(app);
    app[method] = (...args) =>
      original(
        ...args.map((h) =>
          typeof h === 'function' && h.length < 4
            ? function wrapped(req, res, next) {
                try {
                  const out = h.call(this, req, res, next);
                  if (out && typeof out.catch === 'function') out.catch(next);
                } catch (err) {
                  next(err);
                }
              }
            : h,
        ),
      );
  }
  return app;
}
