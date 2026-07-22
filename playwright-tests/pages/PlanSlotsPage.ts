import type { Page, Locator } from "@playwright/test";

/**
 * Page object for src/components/venue/PlanSlotsDialog.tsx — the 存檔面板
 * (三格:存/讀/改名/刪除/覆蓋與讀檔確認), mounted inside PlanEditor at
 * /venue (step "edit" only). All testids come from
 * .claude/pipeline/architect-plan.md D1/D9 and orchestrator-output.md §1-4.
 *
 * Kept in its own file (not merged into PlanEditorPage/AiPanelPage) per
 * orchestrator-output.md Assumption 5 — single responsibility.
 */
export class PlanSlotsPage {
  readonly page: Page;
  readonly openButton: Locator;
  readonly dialog: Locator;
  readonly listError: Locator;
  readonly loadError: Locator;
  readonly saveNameInput: Locator;

  readonly overwriteConfirmDialog: Locator;
  readonly overwriteConfirmCancel: Locator;
  readonly overwriteConfirmAccept: Locator;

  readonly loadConfirmDialog: Locator;
  readonly loadConfirmCancel: Locator;
  readonly loadConfirmAccept: Locator;

  readonly deleteConfirmDialog: Locator;
  readonly deleteConfirmCancel: Locator;
  readonly deleteConfirmAccept: Locator;

  readonly renameDialog: Locator;
  readonly renameInput: Locator;
  readonly renameCancelButton: Locator;
  readonly renameConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.openButton = page.getByTestId("plan-slots-button");
    this.dialog = page.getByTestId("plan-slots-dialog");
    this.listError = page.getByTestId("plan-slots-list-error");
    this.loadError = page.getByTestId("plan-load-error");
    this.saveNameInput = page.getByTestId("plan-save-name-input");

    this.overwriteConfirmDialog = page.getByTestId(
      "plan-overwrite-confirm-dialog",
    );
    this.overwriteConfirmCancel = page.getByTestId(
      "plan-overwrite-confirm-cancel",
    );
    this.overwriteConfirmAccept = page.getByTestId(
      "plan-overwrite-confirm-accept",
    );

    this.loadConfirmDialog = page.getByTestId("plan-load-confirm-dialog");
    this.loadConfirmCancel = page.getByTestId("plan-load-confirm-cancel");
    this.loadConfirmAccept = page.getByTestId("plan-load-confirm-accept");

    this.deleteConfirmDialog = page.getByTestId("plan-delete-confirm-dialog");
    this.deleteConfirmCancel = page.getByTestId("plan-delete-confirm-cancel");
    this.deleteConfirmAccept = page.getByTestId("plan-delete-confirm-accept");

    this.renameDialog = page.getByTestId("plan-rename-dialog");
    this.renameInput = page.getByTestId("plan-rename-input");
    this.renameCancelButton = page.getByTestId("plan-rename-cancel-button");
    this.renameConfirmButton = page.getByTestId("plan-rename-confirm-button");
  }

  async open() {
    await this.openButton.click();
    await this.dialog.waitFor({ state: "visible" });
  }

  row(slot: number): Locator {
    return this.page.getByTestId(`plan-slot-row-${slot}`);
  }

  slotName(slot: number): Locator {
    return this.page.getByTestId(`plan-slot-name-${slot}`);
  }

  slotUpdated(slot: number): Locator {
    return this.page.getByTestId(`plan-slot-updated-${slot}`);
  }

  slotEmpty(slot: number): Locator {
    return this.page.getByTestId(`plan-slot-empty-${slot}`);
  }

  loadButton(slot: number): Locator {
    return this.page.getByTestId(`plan-load-button-${slot}`);
  }

  renameButton(slot: number): Locator {
    return this.page.getByTestId(`plan-rename-button-${slot}`);
  }

  deleteButton(slot: number): Locator {
    return this.page.getByTestId(`plan-delete-button-${slot}`);
  }

  saveButton(slot: number): Locator {
    return this.page.getByTestId(`plan-save-button-${slot}`);
  }

  /** Fills the shared save-name input (optional) and clicks 存入此格 for `slot`. */
  async saveToSlot(slot: number, name?: string) {
    if (name !== undefined) {
      await this.saveNameInput.fill(name);
    }
    await this.saveButton(slot).click();
  }

  /** Confirms the overwrite dialog after saveToSlot targets an occupied slot. */
  async confirmOverwrite() {
    await this.overwriteConfirmDialog.waitFor({ state: "visible" });
    await this.overwriteConfirmAccept.click();
  }

  /** Clicks 讀取 for `slot`. If the workspace is dirty this only opens the confirm dialog. */
  async loadSlot(slot: number) {
    await this.loadButton(slot).click();
  }

  /** Confirms the dirty-load confirm dialog. */
  async confirmLoad() {
    await this.loadConfirmDialog.waitFor({ state: "visible" });
    await this.loadConfirmAccept.click();
  }

  async renameSlot(slot: number, name: string) {
    await this.renameButton(slot).click();
    await this.renameDialog.waitFor({ state: "visible" });
    await this.renameInput.fill(name);
    await this.renameConfirmButton.click();
  }

  async deleteSlot(slot: number) {
    await this.deleteButton(slot).click();
    await this.deleteConfirmDialog.waitFor({ state: "visible" });
    await this.deleteConfirmAccept.click();
  }
}
