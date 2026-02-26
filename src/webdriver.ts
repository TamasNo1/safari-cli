/**
 * Raw W3C WebDriver HTTP client for SafariDriver.
 * No selenium dependency — just fetch() calls.
 */

export class WebDriverError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public webdriverError?: string
  ) {
    super(message);
    this.name = 'WebDriverError';
  }
}

export class WebDriver {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (err: any) {
      throw new WebDriverError(
        `Cannot connect to SafariDriver at ${this.baseUrl}: ${err.message}`
      );
    }

    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new WebDriverError(
          `HTTP ${response.status}: ${text}`,
          response.status
        );
      }
      return text;
    }

    if (json.value && json.value.error) {
      throw new WebDriverError(
        json.value.message || json.value.error,
        response.status,
        json.value.error
      );
    }

    return json.value;
  }

  // --- Session ---

  async createSession(): Promise<string> {
    const result = await this.request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'safari',
          'safari:automaticInspection': true,
          'safari:automaticProfiling': true,
        },
      },
    });
    return result.sessionId;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/session/${sessionId}`);
  }

  async getStatus(): Promise<any> {
    return this.request('GET', '/status');
  }

  // --- Navigation ---

  async navigateTo(sessionId: string, url: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/url`, { url });
  }

  async getCurrentUrl(sessionId: string): Promise<string> {
    return this.request('GET', `/session/${sessionId}/url`);
  }

  async getTitle(sessionId: string): Promise<string> {
    return this.request('GET', `/session/${sessionId}/title`);
  }

  async back(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/back`, {});
  }

  async forward(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/forward`, {});
  }

  async refresh(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/refresh`, {});
  }

  // --- Page ---

  async getPageSource(sessionId: string): Promise<string> {
    return this.request('GET', `/session/${sessionId}/source`);
  }

  async executeScript(
    sessionId: string,
    script: string,
    args: any[] = []
  ): Promise<any> {
    return this.request('POST', `/session/${sessionId}/execute/sync`, {
      script,
      args,
    });
  }

  async executeAsyncScript(
    sessionId: string,
    script: string,
    args: any[] = []
  ): Promise<any> {
    return this.request('POST', `/session/${sessionId}/execute/async`, {
      script,
      args,
    });
  }

  // --- Screenshot ---

  async takeScreenshot(sessionId: string): Promise<string> {
    return this.request('GET', `/session/${sessionId}/screenshot`);
  }

  async takeElementScreenshot(
    sessionId: string,
    elementId: string
  ): Promise<string> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/screenshot`
    );
  }

  // --- Elements ---

  async findElement(
    sessionId: string,
    using: string,
    value: string
  ): Promise<string> {
    const result = await this.request(
      'POST',
      `/session/${sessionId}/element`,
      { using, value }
    );
    // W3C returns { "element-6066...": "id" } or { ELEMENT: "id" }
    const keys = Object.keys(result);
    return result[keys[0]];
  }

  async findElements(
    sessionId: string,
    using: string,
    value: string
  ): Promise<string[]> {
    const results = await this.request(
      'POST',
      `/session/${sessionId}/elements`,
      { using, value }
    );
    return results.map((r: any) => {
      const keys = Object.keys(r);
      return r[keys[0]];
    });
  }

  async clickElement(sessionId: string, elementId: string): Promise<void> {
    await this.request(
      'POST',
      `/session/${sessionId}/element/${elementId}/click`,
      {}
    );
  }

  async sendKeys(
    sessionId: string,
    elementId: string,
    text: string
  ): Promise<void> {
    await this.request(
      'POST',
      `/session/${sessionId}/element/${elementId}/value`,
      { text }
    );
  }

  async clearElement(sessionId: string, elementId: string): Promise<void> {
    await this.request(
      'POST',
      `/session/${sessionId}/element/${elementId}/clear`,
      {}
    );
  }

  async getElementText(
    sessionId: string,
    elementId: string
  ): Promise<string> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/text`
    );
  }

  async getElementTagName(
    sessionId: string,
    elementId: string
  ): Promise<string> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/name`
    );
  }

  async getElementAttribute(
    sessionId: string,
    elementId: string,
    name: string
  ): Promise<string | null> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/attribute/${name}`
    );
  }

  async getElementProperty(
    sessionId: string,
    elementId: string,
    name: string
  ): Promise<any> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/property/${name}`
    );
  }

  async getElementRect(
    sessionId: string,
    elementId: string
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/rect`
    );
  }

  async isElementDisplayed(
    sessionId: string,
    elementId: string
  ): Promise<boolean> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/displayed`
    );
  }

  async isElementEnabled(
    sessionId: string,
    elementId: string
  ): Promise<boolean> {
    return this.request(
      'GET',
      `/session/${sessionId}/element/${elementId}/enabled`
    );
  }

  // --- Cookies ---

  async getCookies(sessionId: string): Promise<any[]> {
    return this.request('GET', `/session/${sessionId}/cookie`);
  }

  async getCookie(sessionId: string, name: string): Promise<any> {
    return this.request('GET', `/session/${sessionId}/cookie/${name}`);
  }

  async addCookie(sessionId: string, cookie: any): Promise<void> {
    await this.request('POST', `/session/${sessionId}/cookie`, { cookie });
  }

  async deleteCookie(sessionId: string, name: string): Promise<void> {
    await this.request('DELETE', `/session/${sessionId}/cookie/${name}`);
  }

  async deleteAllCookies(sessionId: string): Promise<void> {
    await this.request('DELETE', `/session/${sessionId}/cookie`);
  }

  // --- Windows ---

  async getWindowHandle(sessionId: string): Promise<string> {
    return this.request('GET', `/session/${sessionId}/window`);
  }

  async getWindowHandles(sessionId: string): Promise<string[]> {
    return this.request('GET', `/session/${sessionId}/window/handles`);
  }

  async switchToWindow(sessionId: string, handle: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/window`, {
      handle,
    });
  }

  async closeWindow(sessionId: string): Promise<string[]> {
    return this.request('DELETE', `/session/${sessionId}/window`);
  }

  async getWindowRect(
    sessionId: string
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    return this.request('GET', `/session/${sessionId}/window/rect`);
  }

  async setWindowRect(
    sessionId: string,
    rect: { x?: number; y?: number; width?: number; height?: number }
  ): Promise<void> {
    await this.request('POST', `/session/${sessionId}/window/rect`, rect);
  }

  async maximizeWindow(sessionId: string): Promise<void> {
    await this.request(
      'POST',
      `/session/${sessionId}/window/maximize`,
      {}
    );
  }

  async minimizeWindow(sessionId: string): Promise<void> {
    await this.request(
      'POST',
      `/session/${sessionId}/window/minimize`,
      {}
    );
  }

  async fullscreenWindow(sessionId: string): Promise<void> {
    await this.request(
      'POST',
      `/session/${sessionId}/window/fullscreen`,
      {}
    );
  }

  // --- Frames ---

  async switchToFrame(
    sessionId: string,
    id: number | string | null
  ): Promise<void> {
    await this.request('POST', `/session/${sessionId}/frame`, { id });
  }

  async switchToParentFrame(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/frame/parent`, {});
  }

  // --- Alerts ---

  async getAlertText(sessionId: string): Promise<string> {
    return this.request('GET', `/session/${sessionId}/alert/text`);
  }

  async acceptAlert(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/alert/accept`, {});
  }

  async dismissAlert(sessionId: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/alert/dismiss`, {});
  }

  async sendAlertText(sessionId: string, text: string): Promise<void> {
    await this.request('POST', `/session/${sessionId}/alert/text`, { text });
  }

  // --- Timeouts ---

  async setTimeouts(
    sessionId: string,
    timeouts: { script?: number; pageLoad?: number; implicit?: number }
  ): Promise<void> {
    await this.request('POST', `/session/${sessionId}/timeouts`, timeouts);
  }

  async getTimeouts(
    sessionId: string
  ): Promise<{ script: number; pageLoad: number; implicit: number }> {
    return this.request('GET', `/session/${sessionId}/timeouts`);
  }
}
