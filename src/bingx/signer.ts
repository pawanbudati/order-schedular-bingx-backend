import crypto from 'crypto';

export class BingXSigner {
  /**
   * Generates HMAC-SHA256 signature for BingX REST API requests
   * @param params Object containing key-value pairs of request parameters
   * @param secretKey BingX account secret key
   * @returns Object with formatted query string including signature
   */
  public static signParams(params: Record<string, any>, secretKey: string): { queryString: string; signature: string } {
    // Filter out undefined/null
    const keys = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .sort();

    const paramStrings = keys.map((key) => `${key}=${encodeURIComponent(params[key])}`);
    const canonicalString = paramStrings.join('&');

    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(canonicalString)
      .digest('hex');

    const queryString = `${canonicalString}&signature=${signature}`;

    return { queryString, signature };
  }
}
