-- 仅注册媒体工作流权限定义，不更改任何角色的授权。
-- 工作流发布自动生效；媒体业务页面仅办理人工节点或取消当前实例。
SET NAMES utf8mb4;

INSERT INTO admin_menu
  (id,pid,name,path,component,redirect,auth_code,type,meta,status,sort)
SELECT 2041700000000120612,2041700000000100604,'MediaWorkflowRun',NULL,NULL,NULL,
  'Media:Governance:WorkflowRun','button','{"title":"办理与取消工作流"}',1,11
WHERE NOT EXISTS (SELECT 1 FROM admin_menu WHERE id=2041700000000120612 OR name='MediaWorkflowRun' OR auth_code='Media:Governance:WorkflowRun');

UPDATE admin_menu SET meta=JSON_SET(COALESCE(meta,JSON_OBJECT()),'$.title','办理与取消工作流'),status=1,is_deleted=0
WHERE id=2041700000000120612 AND auth_code='Media:Governance:WorkflowRun';

UPDATE admin_menu SET status=0,is_deleted=1
WHERE id=2041700000000120611 AND auth_code='Media:Governance:WorkflowBind';

SELECT CAST(id AS CHAR) AS id,CAST(pid AS CHAR) AS pid,name,auth_code,type,status,is_deleted
FROM admin_menu WHERE id IN (2041700000000120611,2041700000000120612);
