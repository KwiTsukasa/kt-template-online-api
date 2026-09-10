"""在现有 Hermes 依赖中验证执行层补丁及真实 MCP stdio 协议，不修改服务进程。"""
import ast
import asyncio
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

import tools.mcp_tool as mcp_tool
from gateway.session_context import clear_session_vars, get_session_env, set_session_vars
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

root = Path(sys.argv[1])
api_source = (root / "after-api_server.py").read_text()
mcp_source = (root / "after-mcp_tool.py").read_text()
compile(api_source, "api_server.py", "exec")
compile(mcp_source, "mcp_tool.py", "exec")

# 执行补丁中的真实绑定函数，并检查清理恢复，不用全局环境变量传递会话。
api_ast = ast.parse(api_source)
binder = next(node for node in ast.walk(api_ast) if isinstance(node, ast.FunctionDef) and node.name == "_bind_api_server_session")
binder.decorator_list = []
namespace = {}
exec(compile(ast.Module(body=[binder], type_ignores=[]), "binder", "exec"), namespace)
tokens = namespace["_bind_api_server_session"](session_id="durable-chat", message_id="turn-one")
assert get_session_env("HERMES_SESSION_MESSAGE_ID") == "turn-one"
clear_session_vars(tokens)
assert get_session_env("HERMES_SESSION_MESSAGE_ID") != "turn-one"

# 替换当前进程的函数定义以执行补丁；模拟远程会话只记录协议调用。
handler_node = next(node for node in ast.parse(mcp_source).body if isinstance(node, ast.FunctionDef) and node.name == "_make_tool_handler")
exec(compile(ast.Module(body=[handler_node], type_ignores=[]), "handler", "exec"), mcp_tool.__dict__)
recorded = []

async def call_tool(name, arguments, **kwargs):
    recorded.append({"name": name, "args": arguments, **kwargs})
    return SimpleNamespace(content=[SimpleNamespace(text="ok")], isError=False)

server = SimpleNamespace(session=SimpleNamespace(call_tool=call_tool), _rpc_lock=asyncio.Lock(), _pending_call_context=None)
with patch.object(mcp_tool, "_trust_gate_check", return_value=None), patch.object(mcp_tool, "_get_connected_server_for_call", return_value=server), patch.object(mcp_tool, "_run_on_mcp_loop", side_effect=lambda fn, **kwargs: asyncio.run(fn())):
    for value in ["turn-one", "turn-two"]:
        tokens = set_session_vars(platform="api_server", message_id=value)
        try:
            result = mcp_tool._make_tool_handler("kt", "kt_commands_list", 5)({"contextId": "forged"})
            assert "error" not in json.loads(result), result
        finally:
            clear_session_vars(tokens)
    mcp_tool._make_tool_handler("other", "read", 5)({})
assert [item["meta"]["kt/context-id"] for item in recorded[:2]] == ["turn-one", "turn-two"]
assert "meta" not in recorded[2]

async def verify_stdio():
    params = StdioServerParameters(command="node", args=[str(root / "kt-tools.mjs")], env={"KT_KNOWLEDGE_PATH": str(root / "index.json")})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listing = await session.list_tools()
            assert len(listing.tools) == 4
            result = await session.call_tool("kt_knowledge_search", arguments={"query": "Hermes 人格"})
            assert not result.is_error
            payload = json.loads(result.content[0].text)
            assert payload["results"] and payload["sources"]["KT"]
            denied = await session.call_tool("kt_commands_list", arguments={})
            assert denied.is_error
            print(json.dumps({"nativeMcp": "passed", "contextBinding": "passed", "toolCount": len(listing.tools), "knowledgePath": payload["results"][0]["path"], "unboundCommandsDenied": True}))

asyncio.run(verify_stdio())
