'use strict';

class ApiReadError extends Error {
  constructor(status, fatal = false) {
    super('Brightspace API read failed');
    this.code = 'API_READ_FAILED';
    this.status = Number.isInteger(status) ? status : null;
    this.fatal = fatal || status === 401 || status === 403 || status === 429 || status === 503 || status == null;
  }
}
function apiWarning(source, error, details = {}) {
  return { source, code: 'API_READ_FAILED', message: `Unable to read ${source}; discovery is incomplete.`,
    details: { ...details, ...(Number.isInteger(error.status) ? { httpStatus: error.status } : {}) } };
}


const MINIMUM_LE_VERSION = '1.90';
function atLeast(version, minimum = MINIMUM_LE_VERSION) {
  if (!/^\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  const [requiredMajor, requiredMinor] = minimum.split('.').map(Number);
  return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
}
function validateLeRoot(root) {
  const match = new URL(root).pathname.match(/^\/d2l\/api\/le\/(\d+\.\d+)$/);
  if (!match || !atLeast(match[1])) throw new Error(`Discovery requires Brightspace LE ${MINIMUM_LE_VERSION} or later`);
  return match[1];
}


const { id } = require('./id');

// Shared read-only API transport, pagination and URL validation.
function createBrightspaceClient({ get, leRoot }) {
  const version = validateLeRoot(leRoot);
  const origin = new URL(leRoot).origin;
  function safeUrl(path, base = leRoot) {
    const url = new URL(path, base);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password ||
        !url.pathname.startsWith('/d2l/api/')) throw new Error('Invalid Brightspace API URL');
    return url.href;
  }
  async function read(path, raw) {
    const url = safeUrl(path);
    try {
      const data = await get(url);
      if (raw) raw.push({ url, data: redactDiagnostic(data) });
      return data;
    } catch (error) {
      if (error instanceof ApiReadError) throw error;
      throw new ApiReadError(error.response?.status);
    }
  }
  async function list(path, raw) {
    let next = safeUrl(path);
    const seen = new Set();
    const result = [];
    while (next) {
      if (seen.has(next)) throw new Error('Brightspace pagination cycle detected');
      seen.add(next);
      const page = await read(next, raw);
      if (Array.isArray(page)) return result.concat(page);
      if (page && Array.isArray(page.Items) && page.PagingInfo) {
        if (typeof page.PagingInfo.HasMoreItems !== 'boolean') throw new Error('Invalid paging metadata');
        result.push(...page.Items);
        if (!page.PagingInfo.HasMoreItems) return result;
        const bookmark = page.PagingInfo.Bookmark;
        if ((typeof bookmark !== 'string' && typeof bookmark !== 'number') || String(bookmark) === '') {
          throw new Error('Missing pagination bookmark');
        }
        const url = new URL(next);
        url.searchParams.set('bookmark', String(bookmark));
        next = url.href;
        continue;
      }
      if (!page || !Array.isArray(page.Objects) || !Object.hasOwn(page, 'Next')) {
        throw new Error('Invalid Brightspace list response');
      }
      result.push(...page.Objects);
      if (page.Next != null && (typeof page.Next !== 'string' || !page.Next)) {
        throw new Error('Invalid Brightspace pagination link');
      }
      next = page.Next == null ? null : safeUrl(page.Next, next);
    }
    return result;
  }
  const coursePath = (orgUnitId, suffix) => `${leRoot}/${id(orgUnitId)}/${suffix}`;
  const supportsLeVersion = minimum => atLeast(version, minimum);
  return { read, list, coursePath, supportsLeVersion };
}

// Keep the existing service-account token exchange and request safeguards.
function createBrightspaceGet({ http, oauth, baseUrl }) {
  return async function get(path) {
    const url = new URL(path, baseUrl);
    if (url.origin !== new URL(baseUrl).origin || url.protocol !== 'https:') {
      throw new Error('API URL must belong to the configured Brightspace HTTPS origin');
    }
    let token;
    try { token = await oauth.getAccessToken(); }
    catch { throw new ApiReadError(401, true); }
    const response = await http({
      timeout: 15000, maxRedirects: 0, method: 'GET', url: url.href,
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
  };
}

// Debug data is separate from the domain contract and omits known secrets/PII.
function redactDiagnostic(value) {
  if (Array.isArray(value)) return value.map(redactDiagnostic);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /password|token|secret|assertion|private.?key|authorization|notificationemail|userinfo/i.test(key)
      ? '[REDACTED]' : redactDiagnostic(item)]));
}
module.exports = { createBrightspaceClient, createBrightspaceGet };

Object.assign(module.exports, { MINIMUM_LE_VERSION, atLeast, validateLeRoot, ApiReadError, apiWarning });

// Deliberately limited to Assignment detail PUTs; diagnostics still use GET only.
function createAssignmentPut({ http, oauth, leRoot }) {
  validateLeRoot(leRoot);
  const root = new URL(leRoot);
  if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash) throw new Error('Invalid API root');
  return async (path, data) => {
    const url = new URL(path);
    const suffix = url.pathname.slice(root.pathname.length);
    if (url.origin !== root.origin || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith(root.pathname) || !/^\/[1-9]\d*\/dropbox\/folders\/[1-9]\d*$/.test(suffix)) {
      throw new Error('Only configured Assignment detail URLs can be updated');
    }
    let token;
    try { token = await oauth.getAccessToken(); }
    catch { throw new ApiReadError(401, true); }
    try {
      const response = await http({ method: 'PUT', url: url.href, data, timeout: 15000, maxRedirects: 0,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      return response.data;
    } catch (error) {
      const safe = new Error('Assignment API update failed');
      safe.status = Number.isInteger(error.response?.status) ? error.response.status : null;
      throw safe;
    }
  };
}
module.exports.createAssignmentPut = createAssignmentPut;
