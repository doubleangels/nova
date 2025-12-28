require('dotenv').config();
const { setInviteTag, getInviteTag, getValue, setValue } = require('./utils/database');

(async () => {
  const tagName = 'promotion';
  const inviteCode = 'j5sfQtCVSU';
  
  const existingTag = await getInviteTag(tagName);
  const isUpdate = existingTag !== null;
  
  const inviteData = {
    code: inviteCode,
    name: tagName,
    createdAt: isUpdate ? existingTag.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: isUpdate ? existingTag.createdBy : 'system',
    updatedBy: 'system'
  };
  
  await setInviteTag(tagName, inviteData);
  
  const codeToTagMap = await getValue('invite_code_to_tag_map') || {};
  
  if (isUpdate && existingTag.code && existingTag.code.toLowerCase() !== inviteCode.toLowerCase()) {
    delete codeToTagMap[existingTag.code.toLowerCase()];
  }
  
  codeToTagMap[inviteCode.toLowerCase()] = tagName;
  await setValue('invite_code_to_tag_map', codeToTagMap);
  
  console.log(`✅ Successfully ${isUpdate ? 'updated' : 'tagged'} invite code "${inviteCode}" with tag "${tagName}"`);
  process.exit(0);
})();

