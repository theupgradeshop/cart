/** True for the editor's preview routes: `/preview` itself and anything under `/preview/`. Not `/previews`, `/preview-offer`. */
export function isPreviewPath(path: string): boolean {
  return path === '/preview' || path.startsWith('/preview/');
}
