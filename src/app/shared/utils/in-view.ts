import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

/**
 * Prévient une fois, quand l'élément entre à l'écran (`(alcoInView)="charger()"`) : un contenu
 * coûteux ne se charge que s'il est vu. Sans IntersectionObserver (vieux navigateur, tests),
 * il prévient tout de suite.
 */
@Directive({ selector: '[alcoInView]' })
export class AlcoInView {
  readonly alcoInView = output<void>();

  constructor() {
    const element = inject(ElementRef<HTMLElement>).nativeElement;
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => this.alcoInView.emit());
      return;
    }
    // Un peu avant d'être visible : le contenu est prêt quand il arrive à l'écran.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          this.alcoInView.emit();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
