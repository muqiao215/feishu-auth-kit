from . import cli
from .client import FeishuAuthClient, build_permission_url
from .device_flow import DeviceFlowClient, DeviceFlowError
from .models import AppInfo, DeviceAuthorization, DeviceToken, ScopeGrant, TenantAccessToken

AppScope = ScopeGrant
TenantToken = TenantAccessToken

__all__ = [
    "AppInfo",
    "AppScope",
    "DeviceAuthorization",
    "DeviceFlowClient",
    "DeviceFlowError",
    "DeviceToken",
    "FeishuAuthClient",
    "ScopeGrant",
    "TenantAccessToken",
    "TenantToken",
    "build_permission_url",
    "cli",
]
