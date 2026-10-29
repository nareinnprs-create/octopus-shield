export const OSHIELD_EDITOR_SAVE_DIRTY_FILES_EVENT = 'shield:editor-save-dirty-files'
export const OSHIELD_EDITOR_PREPARE_HOT_EXIT_EVENT = 'shield:editor-prepare-hot-exit'

export type EditorSaveDirtyFilesDetail = {
  claim: () => void
  resolve: () => void
  reject: (message: string) => void
}

export type EditorPrepareHotExitDetail = EditorSaveDirtyFilesDetail
