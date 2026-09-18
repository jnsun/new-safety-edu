import "@ant-design/v5-patch-for-react-19";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import "./styles.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const router = createBrowserRouter([{ path: "*", element: <App /> }]);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ConfigProvider locale={zhCN} theme={{
    token: {
      colorPrimary: "#0071e3", colorInfo: "#0071e3", colorSuccess: "#248a3d", colorWarning: "#b25d00", colorError: "#d70015",
      colorText: "#1d1d1f", colorTextSecondary: "#6e6e73", colorBgLayout: "#f5f5f7", colorBorder: "#d2d2d7",
      borderRadius: 14, borderRadiusLG: 20, controlHeight: 42,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif'
    },
    components: {
      Button: { borderRadius: 980, controlHeight: 42, fontWeight: 500 },
      Card: { headerFontSize: 18, headerHeight: 58 },
      Input: { activeShadow: "0 0 0 3px rgba(0, 113, 227, .14)" },
      Select: { activeOutlineColor: "rgba(0, 113, 227, .14)" },
      Table: { headerBg: "#f5f5f7", headerColor: "#424245", rowHoverBg: "#f5faff" },
      Tabs: { itemSelectedColor: "#0071e3", inkBarColor: "#0071e3" }
    }
  }}>
    <QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>
  </ConfigProvider></React.StrictMode>
);
