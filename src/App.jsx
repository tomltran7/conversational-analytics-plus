import React, { useState, useRef, useEffect } from 'react';
import { Send, Database, RefreshCw, TrendingUp, BarChart3, Activity } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, ScatterChart, Scatter, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis } from 'recharts';

// API configuration
const API_BASE = '/api';

// API helper functions
const apiCall = async (endpoint, options = {}) => {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API request failed');
    }

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};

const App = () => {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I can help you analyze your data. Try asking: "How are my sales doing for the last 7 days?"' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentViz, setCurrentViz] = useState(null);
  const [generatedCode, setGeneratedCode] = useState('');
  const [dbConnections, setDbConnections] = useState([]);
  const [selectedDb, setSelectedDb] = useState('');
  const [hiddenSeries, setHiddenSeries] = useState(new Set());
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchDbConnections();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Reset hidden series when visualization changes
    setHiddenSeries(new Set());
  }, [currentViz]);

  const fetchDbConnections = async () => {
    try {
      const data = await apiCall('/databases');
      setDbConnections(data);
      if (data.length > 0) {
        setSelectedDb(data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch DB connections:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Failed to load database connections. Please check your backend server.'
      }]);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setLoading(true);

    try {
      // Call actual backend API
      const response = await apiCall('/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [...messages, userMessage],
          databaseId: selectedDb,
          context: currentViz
        })
      });

      if (!response.success) {
        throw new Error(response.error || 'Chat request failed');
      }

      const aiResponse = response.response;
      
      // Add AI message
      const assistantMessage = { 
        role: 'assistant', 
        content: aiResponse.message || 'I processed your request.' 
      };
      setMessages(prev => [...prev, assistantMessage]);

      // If there's a query, execute it
      if (aiResponse.query) {
        try {
          const queryResult = await apiCall('/query', {
            method: 'POST',
            body: JSON.stringify({
              databaseId: selectedDb,
              query: aiResponse.query
            })
          });

          if (queryResult.success && queryResult.data) {
            // Generate visualization from actual data
            const vizData = await generateVisualization(queryResult.data, aiResponse);
            setCurrentViz(vizData);
          }

          // Set the generated SQL code
          setGeneratedCode(aiResponse.query);
        } catch (queryError) {
          console.error('Query execution error:', queryError);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `I generated a query but encountered an error: ${queryError.message}`
          }]);
        }
      } else if (aiResponse.visualization) {
        // Use AI-suggested visualization
        setCurrentViz(aiResponse.visualization);
        if (aiResponse.query) {
          setGeneratedCode(aiResponse.query);
        }
      }

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Sorry, I encountered an error: ${error.message}` 
      }]);
    } finally {
      setLoading(false);
    }
  };

  const generateVisualization = async (data, aiResponse) => {
    if (!data || data.length === 0) {
      return null;
    }

    try {
      // Get visualization suggestion from AI
      const vizResponse = await apiCall('/visualize', {
        method: 'POST',
        body: JSON.stringify({
          data: data,
          query: aiResponse.query
        })
      });

      if (vizResponse.success && vizResponse.visualization) {
        const viz = vizResponse.visualization;
        const colors = [
          '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', 
          '#3b82f6', '#ec4899', '#14b8a6', '#f97316',
          '#8b5cf6', '#a855f7', '#06b6d4', '#84cc16'
        ];
        
        const baseViz = {
          type: viz.type || 'line',
          data: data,
          title: viz.title || 'Query Results',
          xKey: viz.xKey || Object.keys(data[0])[0],
          yKey: viz.yKey || Object.keys(data[0])[1]
        };

        // Type-specific configuration
        if (viz.type === 'scatter') {
          return {
            ...baseViz,
            xKey: viz.xKey || Object.keys(data[0])[0],
            yKey: viz.yKey || Object.keys(data[0])[1],
            zKey: viz.zKey, // Optional third dimension for bubble size
            scatterSeries: viz.scatterSeries || [{
              name: viz.name || 'Data Points',
              color: colors[0],
              shape: 'circle'
            }]
          };
        } else if (viz.type === 'donut' || viz.type === 'pie') {
          return {
            ...baseViz,
            type: 'donut',
            nameKey: viz.nameKey || Object.keys(data[0])[0],
            valueKey: viz.valueKey || Object.keys(data[0])[1],
            colors: colors
          };
        } else if (viz.type === 'line') {
          return {
            ...baseViz,
            lines: viz.yKeys ? viz.yKeys.map((key, idx) => ({
              key: key,
              color: colors[idx % colors.length],
              name: key.replace(/_/g, ' ').toUpperCase(),
              strokeWidth: 2,
              dot: { r: 4 },
              activeDot: { r: 6 }
            })) : [{ 
              key: Object.keys(data[0])[1], 
              color: colors[0], 
              name: 'Value',
              strokeWidth: 2,
              dot: { r: 4 },
              activeDot: { r: 6 }
            }]
          };
        } else if (viz.type === 'bar') {
          return {
            ...baseViz,
            bars: viz.yKeys ? viz.yKeys.map((key, idx) => ({
              key: key,
              color: colors[idx % colors.length],
              name: key.replace(/_/g, ' ').toUpperCase()
            })) : [{
              key: Object.keys(data[0])[1],
              color: colors[0],
              name: 'Value'
            }]
          };
        }
      }
    } catch (error) {
      console.error('Visualization generation error:', error);
    }

    // Fallback: Intelligent chart type detection
    const keys = Object.keys(data[0]);
    const xKey = keys[0];
    
    // Identify numeric columns for multi-series
    const numericKeys = keys.slice(1).filter(key => {
      const value = data[0][key];
      return typeof value === 'number' || !isNaN(parseFloat(value));
    });

    const colors = [
      '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', 
      '#3b82f6', '#ec4899', '#14b8a6', '#f97316'
    ];

    // Auto-detect best chart type
    const shouldUseDonut = data.length <= 10 && numericKeys.length === 1 && 
                          (keys[0].includes('category') || keys[0].includes('type') || 
                           keys[0].includes('name') || keys[0].includes('segment'));
    
    const shouldUseScatter = numericKeys.length >= 2 && data.length >= 10;

    if (shouldUseDonut) {
      return {
        type: 'donut',
        data: data,
        title: 'Distribution Analysis',
        nameKey: keys[0],
        valueKey: numericKeys[0],
        colors: colors
      };
    } else if (shouldUseScatter) {
      return {
        type: 'scatter',
        data: data,
        title: 'Correlation Analysis',
        xKey: numericKeys[0],
        yKey: numericKeys[1],
        zKey: numericKeys[2], // Optional
        scatterSeries: [{
          name: 'Data Points',
          color: colors[0],
          shape: 'circle'
        }]
      };
    }

    // Default to line chart with multiple series
    return {
      type: 'line',
      data: data,
      title: 'Query Results',
      xKey: xKey,
      lines: numericKeys.map((key, idx) => ({
        key: key,
        color: colors[idx % colors.length],
        name: key.replace(/_/g, ' ').toUpperCase(),
        strokeWidth: 2,
        dot: { r: 4 },
        activeDot: { r: 6 }
      }))
    };
  };

  const toggleSeries = (seriesKey) => {
    setHiddenSeries(prev => {
      const newSet = new Set(prev);
      if (newSet.has(seriesKey)) {
        newSet.delete(seriesKey);
      } else {
        newSet.add(seriesKey);
      }
      return newSet;
    });
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          {label && <p className="font-semibold text-gray-800 mb-1">{label}</p>}
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: <span className="font-semibold">{typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const CustomPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.05) return null; // Hide labels for small slices

    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        className="text-xs font-semibold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const renderVisualization = () => {
    if (!currentViz) return null;

    const { type, data, title, xKey, yKey, zKey, lines, bars, nameKey, valueKey, colors, scatterSeries } = currentViz;

    // Filter visible lines/bars
    const visibleLines = lines ? lines.filter(line => !hiddenSeries.has(line.key)) : [];
    const visibleBars = bars ? bars.filter(bar => !hiddenSeries.has(bar.key)) : [];

    return (
      <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
            {lines && lines.length > 1 && (
              <p className="text-sm text-gray-500 mt-1">
                Showing {visibleLines.length} of {lines.length} series
              </p>
            )}
            {type === 'donut' && (
              <p className="text-sm text-gray-500 mt-1">
                {data.length} categories • Total: {data.reduce((sum, d) => sum + (d[valueKey] || 0), 0).toLocaleString()}
              </p>
            )}
            {type === 'scatter' && (
              <p className="text-sm text-gray-500 mt-1">
                {data.length} data points • X: {xKey.toUpperCase()} • Y: {yKey.toUpperCase()}
              </p>
            )}
          </div>
          
          {/* Series Toggle Controls */}
          {lines && lines.length > 1 && (
            <div className="flex flex-wrap gap-2 max-w-md">
              {lines.map(line => (
                <button
                  key={line.key}
                  onClick={() => toggleSeries(line.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    hiddenSeries.has(line.key)
                      ? 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      : 'text-white hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: hiddenSeries.has(line.key) ? undefined : line.color
                  }}
                >
                  <span className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${hiddenSeries.has(line.key) ? 'bg-gray-400' : 'bg-white'}`}></span>
                    {line.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ResponsiveContainer width="100%" height={350}>
          {type === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey={xKey} 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
                onClick={(e) => toggleSeries(e.dataKey)}
                iconType="line"
              />
              {visibleLines.map(line => (
                <Line 
                  key={line.key}
                  type="monotone" 
                  dataKey={line.key} 
                  stroke={line.color} 
                  strokeWidth={line.strokeWidth || 2}
                  name={line.name}
                  dot={{ fill: line.color, r: line.dot?.r || 4 }}
                  activeDot={{ r: line.activeDot?.r || 6 }}
                  animationDuration={500}
                />
              ))}
            </LineChart>
          ) : type === 'bar' ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey={xKey} 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
                onClick={(e) => toggleSeries(e.dataKey)}
              />
              {visibleBars.map(bar => (
                <Bar 
                  key={bar.key}
                  dataKey={bar.key} 
                  fill={bar.color}
                  name={bar.name}
                  animationDuration={500}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          ) : type === 'scatter' ? (
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                type="number" 
                dataKey={xKey} 
                name={xKey.toUpperCase()}
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              <YAxis 
                type="number" 
                dataKey={yKey} 
                name={yKey.toUpperCase()}
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
              />
              {zKey && (
                <ZAxis 
                  type="number" 
                  dataKey={zKey} 
                  range={[50, 400]} 
                  name={zKey.toUpperCase()}
                />
              )}
              <Tooltip 
                cursor={{ strokeDasharray: '3 3' }}
                content={<CustomTooltip />}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              {scatterSeries && scatterSeries.map((series, idx) => (
                <Scatter 
                  key={idx}
                  name={series.name}
                  data={data} 
                  fill={series.color}
                  shape={series.shape || 'circle'}
                  animationDuration={500}
                />
              ))}
            </ScatterChart>
          ) : type === 'donut' ? (
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={<CustomPieLabel />}
                outerRadius={120}
                innerRadius={60}
                fill="#8884d8"
                dataKey={valueKey}
                nameKey={nameKey}
                animationDuration={500}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend 
                verticalAlign="bottom" 
                height={36}
                formatter={(value, entry) => {
                  const total = data.reduce((sum, d) => sum + d[valueKey], 0);
                  const percent = ((entry.payload.value / total) * 100).toFixed(1);
                  return `${value} (${percent}%)`;
                }}
              />
            </PieChart>
          ) : null}
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-purple-600" />
            <h1 className="text-xl font-bold text-gray-800">Data Analytics AI</h1>
          </div>
          <div className="flex items-center gap-4">
            <select 
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {dbConnections.map(db => (
                <option key={db.id} value={db.id}>
                  {db.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-gray-600">Connected</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-purple-600" />
              Chat Assistant
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  msg.role === 'user' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  <p className="text-sm">{msg.content}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-4 border-t border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about your data..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Visualization & Code */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Visualization Area */}
          <div className="flex-1 p-6 overflow-y-auto">
            {currentViz ? (
              renderVisualization()
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Ask a question to see visualizations</p>
                </div>
              </div>
            )}
          </div>

          {/* Code Panel */}
          <div className="h-64 border-t border-gray-200 bg-gray-900 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Generated SQL Query
              </h3>
            </div>
            {generatedCode ? (
              <pre className="text-sm text-green-400 font-mono">
                <code>{generatedCode}</code>
              </pre>
            ) : (
              <p className="text-sm text-gray-500">No query generated yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;