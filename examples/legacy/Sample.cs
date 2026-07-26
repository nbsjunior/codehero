using System.Data.SqlClient;

namespace Legacy.Repositories
{
    public class CustomerRepository
    {
        public Customer FindByName(string name)
        {
            var cmd = new SqlCommand("SELECT * FROM Customers WHERE Name = '" + name + "'");
            return cmd.ExecuteReader().Read() ? MapCustomer(cmd) : null;
        }

        public Customer FindByIdSafe(int id, SqlConnection conn)
        {
            var cmd = new SqlCommand("SELECT * FROM Customers WHERE Id = @id", conn);
            cmd.Parameters.AddWithValue("@id", id);
            return cmd.ExecuteReader().Read() ? MapCustomer(cmd) : null;
        }
    }
}
