/*
 * Since nodegit is a native module, it gives jest all kinds of hell.
 * This makes it so that it never actually gets used in any test...whatsoever
 */
module.exports = jest.fn();
module.exports.enableThreadSafety = jest.fn();