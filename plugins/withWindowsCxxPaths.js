'use strict';
const { withAppBuildGradle, createRunOncePlugin } = require('expo/config-plugins');
const BEGIN = '// @generated begin manage3d-windows-cxx';
const END = '// @generated end manage3d-windows-cxx';
function configureGradle(contents) {
  const start = contents.indexOf(BEGIN);
  const end = contents.indexOf(END);
  if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) throw new Error('Incomplete manage3d Windows native-build block; refusing to overwrite Gradle configuration');
  const original = start < 0 ? contents : contents.slice(0, start) + contents.slice(end + END.length);
  const block = `${BEGIN}
if (System.getProperty('os.name').startsWith('Windows')) {
    android {
        defaultConfig {
            externalNativeBuild {
                cmake { arguments '-DCMAKE_OBJECT_PATH_MAX=255' }
            }
        }
        externalNativeBuild {
            cmake {
                // Leave room for hashed autolink paths and generated C++ filenames.
                buildStagingDirectory file(findProperty('manage3dCxxStagingDirectory') ?: "$rootDir/../.tmp")
            }
        }
    }
}
${END}`;
  return original.trimEnd() + '\n\n' + block + '\n';
}
const withWindowsCxxPaths = config => withAppBuildGradle(config, mod => {
  if (mod.modResults.language !== 'groovy') throw new Error('Manage3D Windows native paths require a Groovy app build.gradle');
  mod.modResults.contents = configureGradle(mod.modResults.contents);
  return mod;
});
module.exports = createRunOncePlugin(withWindowsCxxPaths, 'manage3d-windows-cxx', '1.0.0');
module.exports.configureGradle = configureGradle;
