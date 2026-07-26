CREATE PROCEDURE dbo.FindCustomerByName
    @CustomerName NVARCHAR(100)
AS
BEGIN
    DECLARE @sql NVARCHAR(MAX);
    SET @sql = 'SELECT * FROM Customers WHERE Name = ''' + @CustomerName + '''';
    EXEC(@sql);
END;
GO

CREATE PROCEDURE dbo.FindCustomerByNameSafe
    @CustomerName NVARCHAR(100)
AS
BEGIN
    EXEC sp_executesql N'SELECT * FROM Customers WHERE Name = @Name', N'@Name NVARCHAR(100)', @Name = @CustomerName;
END;
GO
