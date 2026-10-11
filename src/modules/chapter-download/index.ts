import { registerModule } from '../../core/registry';
import type { GrandloadModule, ModuleApi, PageContext } from '../../core/types';

type SelectablePage = {
  id: string;
  label: string;
  url: string;
  selected: boolean;
};

function collectChapterImages(tabId: number): Promise<SelectablePage[]> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.scripting ||
    typeof chrome.scripting.executeScript !== 'function'
  ) {
    return Promise.resolve([]);
  }

  return new Promise<SelectablePage[]>((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => {
          const seen = new Set<string>();
          const images = Array.from(document.querySelectorAll('img'));

          return images
            .filter(
              (image) => !image.closest('header, footer, nav, aside, .logo, .avatar, .social'),
            )
            .map((image, index) => {
              const sources = [
                image.getAttribute('src'),
                image.getAttribute('data-src'),
                image.getAttribute('data-lazy-src'),
                image.getAttribute('data-original'),
              ].filter((value): value is string => Boolean(value));

              const url = sources[0] ?? '';
              if (!url || seen.has(url)) {
                return null;
              }

              seen.add(url);
              const cleanedUrl = new URL(url, window.location.href).toString();
              const base = cleanedUrl.split('/').filter(Boolean).pop() || `Page ${index + 1}`;
              return {
                id: `${index}-${cleanedUrl}`,
                label: base.length > 30 ? `${base.slice(0, 27)}…` : base,
                url: cleanedUrl,
                selected: true,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
        },
      },
      (results) => {
        const first = results?.[0]?.result as
          Array<{ id: string; label: string; url: string; selected: boolean }> | undefined;
        resolve(first ?? []);
      },
    );
  });
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline-secondary';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function buildEmptyState(): HTMLDivElement {
  const message = document.createElement('div');
  message.className = 'alert alert-warning mb-0';
  message.textContent = 'Aucune image détectée sur cette page ou chapitre vide.';
  return message;
}

const chapterDownloadModule: GrandloadModule = {
  id: 'chapter-download',
  title: 'Télécharger le chapitre',
  priority: 100,
  requiredPermissions: ['activeTab'],
  canHandle: (ctx: PageContext) => ctx.kind === 'chapter',
  mountPopup: (root: HTMLElement, ctx: PageContext, _api: ModuleApi): void => {
    const state: { items: SelectablePage[] } = { items: [] };
    const panel = document.createElement('div');
    panel.className = 'd-grid gap-3';
    root.appendChild(panel);

    const heading = document.createElement('div');
    heading.className = 'fw-semibold';
    heading.textContent = 'Télécharger le chapitre';
    panel.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'small text-muted';
    meta.textContent = `Source : ${ctx.url}`;
    panel.appendChild(meta);

    const actionRow = document.createElement('div');
    actionRow.className = 'd-flex flex-wrap gap-2';
    panel.appendChild(actionRow);

    const grid = document.createElement('div');
    grid.className = 'd-grid gap-2';
    panel.appendChild(grid);

    const buttonDownload = document.createElement('button');
    buttonDownload.type = 'button';
    buttonDownload.className = 'btn btn-primary w-100';
    buttonDownload.disabled = true;
    buttonDownload.textContent = 'Bientôt disponible';
    panel.appendChild(buttonDownload);

    const renderGrid = (): void => {
      grid.innerHTML = '';

      if (state.items.length === 0) {
        grid.appendChild(buildEmptyState());
        return;
      }

      for (const item of state.items) {
        const entry = document.createElement('label');
        entry.className = 'd-flex align-items-center gap-2 p-2 border rounded';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.selected;
        checkbox.addEventListener('change', () => {
          item.selected = checkbox.checked;
        });

        const text = document.createElement('span');
        text.className = 'small text-truncate';
        text.textContent = `${item.label}`;

        entry.appendChild(checkbox);
        entry.appendChild(text);
        grid.appendChild(entry);
      }
    };

    const updateActions = (): void => {
      const selectedCount = state.items.filter((item) => item.selected).length;
      buttonDownload.disabled = selectedCount === 0;
      buttonDownload.textContent =
        selectedCount === 0 ? 'Bientôt disponible' : `Bientôt disponible (${selectedCount})`;
    };

    actionRow.appendChild(
      createActionButton('Tout', () => {
        state.items.forEach((item) => {
          item.selected = true;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Aucune', () => {
        state.items.forEach((item) => {
          item.selected = false;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Inverser', () => {
        state.items.forEach((item) => {
          item.selected = !item.selected;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Exclure avant', () => {
        const selected = state.items.filter((item) => item.selected);
        const lastSelected = selected.at(-1);
        const cursor = lastSelected ? state.items.indexOf(lastSelected) : 0;
        state.items.forEach((item, index) => {
          item.selected = index >= cursor;
        });
        renderGrid();
        updateActions();
      }),
    );
    actionRow.appendChild(
      createActionButton('Exclure après', () => {
        const selected = state.items.filter((item) => item.selected);
        const firstSelected = selected[0];
        const cursor = firstSelected ? state.items.indexOf(firstSelected) : state.items.length - 1;
        state.items.forEach((item, index) => {
          item.selected = index <= cursor;
        });
        renderGrid();
        updateActions();
      }),
    );

    void collectChapterImages(ctx.tabId).then((items) => {
      state.items = items;
      renderGrid();
      updateActions();
    });
  },
};

registerModule(chapterDownloadModule);

export default chapterDownloadModule;
