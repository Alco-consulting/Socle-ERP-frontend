import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
  model,
  viewChildren,
} from '@angular/core';

/** Content of one tab: `<ng-template alcoTabPanel="lines">…</ng-template>`. */
@Directive({ selector: 'ng-template[alcoTabPanel]' })
export class AlcoTabPanel {
  readonly id = input.required<string>({ alias: 'alcoTabPanel' });
  readonly template = inject(TemplateRef);
}

export interface TabItem {
  readonly id: string;
  readonly label: string;
  /** Small counter next to the label (lines, attachments, errors). */
  readonly count?: number;
  /** Marks the tab when it contains invalid fields. */
  readonly invalid?: boolean;
}

/**
 * Tabs separate secondary information inside a form (lines, documents, advanced fields).
 * WAI-ARIA tabs pattern: arrows move between tabs, Home/End jump, only the active tab is
 * in the tab order. Only the active panel is rendered.
 */
@Component({
  selector: 'alco-tabs',
  imports: [NgTemplateOutlet],
  templateUrl: './tabs.html',
  styleUrl: './tabs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoTabs {
  private static nextId = 0;

  readonly tabs = input.required<readonly TabItem[]>();
  readonly selected = model.required<string>();
  readonly label = input.required<string>();

  private readonly panels = contentChildren(AlcoTabPanel);
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tab');

  protected readonly baseId = `alco-tabs-${AlcoTabs.nextId++}`;
  protected readonly activePanel = computed(() =>
    this.panels().find((panel) => panel.id() === this.selected()),
  );

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const count = this.tabs().length;
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % count,
      ArrowLeft: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const target = targets[event.key];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    this.selected.set(this.tabs()[target].id);
    this.tabButtons()[target]?.nativeElement.focus();
  }
}
