-- 本地成员增加所属项目信息
ALTER TABLE local_members ADD COLUMN project_id INTEGER;
ALTER TABLE local_members ADD COLUMN project_name TEXT;
