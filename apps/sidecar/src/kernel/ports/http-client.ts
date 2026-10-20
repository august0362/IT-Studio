export interface IHttpClient {
  request(input: string | URL, init?: RequestInit): Promise<Response>;
}
