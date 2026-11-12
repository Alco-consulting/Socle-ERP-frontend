import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ParamMap, Params } from '@angular/router';

/** Les tailles de page proposées sous une liste. */
export const PAGE_SIZES: readonly number[] = [20, 40, 50, 100];

/** La taille par défaut d'une liste. */
export const DEFAULT_PAGE_SIZE = 20;

/** Le paramètre d'adresse de la taille choisie (`?par_page=40`). */
export const PAGE_SIZE_PARAM = 'par_page';

/** La clé de la préférence sur cet appareil. */
const KEY = 'alco.pageSize';

/** Une taille proposée, ou `null` pour toute autre valeur (absente, inventée, hors liste). */
export function pageSizeOf(value: string | number | null | undefined): number | null {
  const size = Number(value);
  return PAGE_SIZES.includes(size) ? size : null;
}

/**
 * La taille de page préférée sur cet appareil : la dernière choisie sous une liste, reprise par
 * les autres listes tant que l'adresse n'en donne pas une. Un stockage indisponible laisse la
 * taille par défaut, sans erreur.
 */
@Injectable({ providedIn: 'root' })
export class PageSizePreference {
  private readonly state = signal(this.read());
  readonly size = this.state.asReadonly();

  /**
   * La taille d'une liste : celle de l'adresse si elle est proposée, sinon la préférence.
   */
  resolve(fromUrl: string | null): number {
    return pageSizeOf(fromUrl) ?? this.state();
  }

  remember(size: number): void {
    const valid = pageSizeOf(size);
    if (valid === null) {
      return;
    }
    this.state.set(valid);
    try {
      localStorage.setItem(KEY, String(valid));
    } catch {
      // Fenêtre privée ou stockage bloqué : la taille vaut jusqu'à la fermeture de la page.
    }
  }

  private read(): number {
    try {
      return pageSizeOf(localStorage.getItem(KEY)) ?? DEFAULT_PAGE_SIZE;
    } catch {
      return DEFAULT_PAGE_SIZE;
    }
  }
}

/** La pagination d'une liste dont l'état vit dans l'adresse. */
export interface ListPaging {
  /** Les tailles proposées sous la liste. */
  readonly sizes: readonly number[];
  /** La taille en vigueur : celle de l'adresse, sinon la préférence de l'appareil. */
  readonly size: Signal<number>;
  /**
   * Retient `size` comme préférence et rend les paramètres d'adresse à fusionner : la taille,
   * et la page (`pageParam`) remise à la première.
   */
  choose(size: number, pageParam: string): Params;
}

/** À appeler dans le contexte d'injection d'une liste, avec ses paramètres d'adresse. */
export function listPaging(params: Signal<ParamMap>): ListPaging {
  const preference = inject(PageSizePreference);
  return {
    sizes: PAGE_SIZES,
    size: computed(() => preference.resolve(params().get(PAGE_SIZE_PARAM))),
    choose(size: number, pageParam: string): Params {
      preference.remember(size);
      return { [PAGE_SIZE_PARAM]: pageSizeOf(size), [pageParam]: null };
    },
  };
}
