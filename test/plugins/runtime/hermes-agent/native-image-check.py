"""在独立进程内执行图片桥接补丁，确认主模型收到图像字节而不是文件路径。"""
import ast
import asyncio
import base64
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

import tools.mcp_tool as mcp_tool
from agent.tool_dispatch_helpers import _is_multimodal_tool_result, _multimodal_text_summary

source = Path(sys.argv[1]).read_text(encoding="utf-8-sig")
compile(source, "mcp_tool.py", "exec")
node = next(item for item in ast.parse(source).body if isinstance(item, ast.FunctionDef) and item.name == "_make_tool_handler")
exec(compile(ast.Module(body=[node], type_ignores=[]), "handler", "exec"), mcp_tool.__dict__)
encoded = base64.b64encode(b"\x89PNG\r\n\x1a\n-test-image").decode()
content = []

async def call_tool(name, arguments, **kwargs):
    """返回可替换的 MCP 内容，用于执行真实适配函数。"""
    return SimpleNamespace(content=content, isError=False)

server = SimpleNamespace(session=SimpleNamespace(call_tool=call_tool), _rpc_lock=asyncio.Lock(), _pending_call_context=None)
with patch.object(mcp_tool, "_trust_gate_check", return_value=None), patch.object(mcp_tool, "_get_connected_server_for_call", return_value=server), patch.object(mcp_tool, "_run_on_mcp_loop", side_effect=lambda fn, **kwargs: asyncio.run(fn())), patch.object(mcp_tool, "_cache_mcp_image_block", return_value="MEDIA:legacy.png"):
    content[:] = [SimpleNamespace(type="text", text='{"messageId":"original","index":0}'), SimpleNamespace(type="image", mimeType="image/png", data=encoded)]
    result = mcp_tool._make_tool_handler("kt", "kt_chat_image", 5)({})
    assert isinstance(result, dict), result
    assert _is_multimodal_tool_result(result)
    assert result["content"][1]["image_url"]["url"] == "data:image/png;base64," + encoded
    assert "original" in result["content"][0]["text"]
    other = json.loads(mcp_tool._make_tool_handler("other", "image", 5)({}))
    assert "MEDIA:legacy.png" in other["result"]
    content[:] = [SimpleNamespace(type="image", mimeType="image/png", data="invalid!")]
    assert "error" in json.loads(mcp_tool._make_tool_handler("kt", "kt_chat_image", 5)({}))
    content[:] = [SimpleNamespace(type="image", mimeType="image/png", data=encoded)] * 9
    assert "error" in json.loads(mcp_tool._make_tool_handler("kt", "kt_chat_image", 5)({}))

agent_source = Path("/opt/hermes/run_agent.py").read_text()
method = next(item for item in ast.walk(ast.parse(agent_source)) if isinstance(item, ast.FunctionDef) and item.name == "_tool_result_content_for_active_model")
namespace = {"Any": object, "_is_multimodal_tool_result": _is_multimodal_tool_result, "_multimodal_text_summary": _multimodal_text_summary}
exec(compile(ast.Module(body=[method], type_ignores=[]), "model-dispatch", "exec"), namespace)
agent = SimpleNamespace(_content_has_image_parts=lambda parts: True, _model_supports_vision=lambda: True, _provider_supports_vision_tool_messages=lambda: True)
actual = namespace[method.name](agent, "mcp_kt_chat_image", result)
assert actual[1]["type"] == "image_url"
print(json.dumps({"nativeMcpImage": "passed", "modelImageDispatch": "passed", "sourceMetadata": "preserved", "otherServers": "unchanged", "invalidAndExcessImages": "rejected"}))
