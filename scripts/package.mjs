import packager from '@electron/packager';
const paths=await packager({dir:'.',out:'release',name:'Brinky',platform:'win32',arch:'x64',overwrite:true,asar:{unpackDir:'native'},icon:'renderer/brinky.ico',prune:true,ignore:[/^\/release(?:\/|$)/,/^\/test(?:\/|$)/,/^\/scripts(?:\/|$)/,/^\/vendor\/siwc-local\/src(?:\/|$)/],win32metadata:{CompanyName:'Brinky',FileDescription:'Brinky desktop guide',ProductName:'Brinky',InternalName:'Brinky'}});
console.log(paths.join('\n'));
