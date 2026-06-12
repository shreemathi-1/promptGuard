/**
 * Reusable request body validator.
 * Pass a validation function — if it returns an error string, 
 * the request is rejected with 400.
 *
 * Usage:
 *   router.post('/', validate(req => {
 *     if (!req.body.text) return 'text is required';
 *   }), handler);
 */

function validate(validatorFn) {
  return (req, res, next) => {
    const error = validatorFn(req);
    if (error) {
      return res.status(400).json({ success: false, error });
    }
    next();
  };
}

module.exports = { validate };