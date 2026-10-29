/** Desktop and shield serve share the app’s platform recognizer addon; octopod slots omit the ~70 MB package. */

/** Set by `shield serve` for octopod: the directory of the app's recognizer package. */
export const SPEECH_RECOGNIZER_DIR_ENV = 'OSHIELD_SPEECH_RECOGNIZER_DIR'

export function speechRecognizerPackageName(platform: string, arch: string): string {
  return platform === 'win32' && arch === 'x64'
    ? 'sherpa-onnx-win-x64'
    : `sherpa-onnx-${platform}-${arch}`
}
