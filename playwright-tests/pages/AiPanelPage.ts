import type { Page, Locator } from "@playwright/test";
import path from "path";

/**
 * Page object for src/components/venue/AiPanel.tsx, mounted inside the
 * plan editor at /venue (step "edit" only). All acceptance testids come
 * from .claude/pipeline/orchestrator-output.md AC1/AC3/AC4.
 */
export class AiPanelPage {
  readonly page: Page;
  readonly toggle: Locator;
  readonly panel: Locator;
  readonly messages: Locator;
  readonly input: Locator;
  readonly sendButton: Locator;
  readonly imageInput: Locator;
  readonly loading: Locator;
  readonly balance: Locator;
  readonly error: Locator;
  readonly actionSummary: Locator;
  readonly lastAssistantText: Locator;
  readonly chatCost: Locator;
  readonly imageButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.toggle = page.getByTestId("ai-panel-toggle");
    this.panel = page.getByTestId("ai-panel");
    this.messages = page.getByTestId("ai-messages");
    this.input = page.getByTestId("ai-input");
    this.sendButton = page.getByTestId("ai-send");
    this.imageInput = page.getByTestId("ai-image-input");
    this.loading = page.getByTestId("ai-loading");
    this.balance = page.getByTestId("ai-balance");
    this.error = page.getByTestId("ai-error");
    this.actionSummary = page.getByTestId("ai-action-summary");
    this.lastAssistantText = page.getByTestId("ai-assistant-text").last();
    this.chatCost = page.getByTestId("ai-chat-cost");
    this.imageButton = page.getByTestId("ai-image-button");
  }

  async open() {
    await this.toggle.click();
    await this.panel.waitFor({ state: "visible" });
  }

  async sendMessage(text: string) {
    await this.input.fill(text);
    await this.sendButton.click();
  }

  /** Uploads a draft image — a fixture file path, or an in-memory buffer payload. */
  async uploadImage(file: Parameters<Locator["setInputFiles"]>[0]) {
    await this.imageInput.setInputFiles(file);
  }

  /** Absolute path helper for fixture files under playwright-tests/fixtures. */
  static fixturePath(name: string): string {
    return path.join(__dirname, "..", "fixtures", name);
  }
}
